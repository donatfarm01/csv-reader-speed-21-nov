// solve.js — a fast drop-in for csv-reader 1.0.0.
//
// Written fresh from the RULES.txt specification (never from the reference
// implementation): the text is read once, left to right, with commas and
// double quotes. A U+FEFF at the very start is dropped. A record ends at LF
// or CRLF, and a line left with no characters is no record. Outside quotes a
// CR not followed by LF is dropped (error stray_cr). A field whose first
// character is such a CR — one dropped at a record boundary, or at the
// field's own start — reads as unquoted, so a quote after it is a literal
// character. A field that opens with
// a quote runs to the next quote that is not doubled, "" inside it one quote
// and each CRLF or lone CR inside it read as LF; what follows its closing
// quote, up to the next comma or line break, is appended as it stands
// (quote_junk, when the field ends); a quote that never closes is a literal
// character, and the text after it is read again as unquoted
// (unterminated_quote). A quote inside an unquoted field is a literal
// character. Fields stay strings, never trimmed or converted. columns is the
// first record when header is true, else null; rows holds the records after
// it (every record when header is false), each padded with empty strings
// (short_row, with fields: its field count) or cut (long_row, with extra:
// the cut fields) to the first record's width. Each error is
// {code, line, row}, in the order met, a record's short_row or long_row when
// it ends: line the 1-based line its record starts on, counting every LF,
// CRLF and lone CR inside quotes, and row its record's index in rows, null
// for the header.
//
// Speed notes: unquoted fields and the junk after a closing quote are found
// with a tight charCodeAt loop (cheaper than indexOf jumps for the short
// fields here); quoted fields are located with indexOf jumps over the
// closing quote and their value is a slice unless it holds "" escapes or
// CRs, in which case a native replace folds them. Errors are attributed to
// the record being parsed, or — at a record boundary — to the next record
// to start.

// Term codes used by the field scanners.
const T_COMMA = 44; // ','
const T_LF = 10; // '\n'
const T_CRLF = 13; // '\r' of a CRLF pair
const T_EOF = 0;

const DQ_RE = /""/g;
const CR_RE = /\r\n?/g;

// Row index the next record to start will take (null when it would be the
// header record). records = number of records already completed.
function nextRow(records, header) {
  const r = records - (header ? 1 : 0);
  return r < 0 ? null : r;
}

// Count line breaks in text[a..b): every LF counts one, every CR not
// followed by LF counts one (a CRLF pair counts once, via its LF).
function countBreaks(text, a, b) {
  let c = 0;
  let p = a;
  for (;;) {
    const nl = text.indexOf('\n', p);
    if (nl === -1 || nl >= b) break;
    c++;
    p = nl + 1;
  }
  p = a;
  for (;;) {
    const r = text.indexOf('\r', p);
    if (r === -1 || r >= b) break;
    if (r + 1 >= b || text.charCodeAt(r + 1) !== 10) c++;
    p = r + 1;
  }
  return c;
}

// Scan one unquoted field (or the junk after a closing quote) starting at
// pos: the text up to the next comma, LF, CRLF or EOF, with lone CRs dropped
// (each dropped CR pushes a stray_cr error, attributed with errLine/errRow).
// Returns [value, end, term] where end is the terminator position and term
// is T_COMMA, T_LF, T_CRLF or T_EOF. The delimiter is found with a tight
// charCodeAt loop (cheaper than indexOf jumps for the short fields here);
// a lone CR falls into a piece-building slow path.
function scanField(text, n, pos, errors, errLine, errRow) {
  let p = pos;
  let pieces = null;
  for (;;) {
    let q = p;
    while (q < n) {
      const ch = text.charCodeAt(q);
      if (ch === 44 || ch === 10 || ch === 13) break;
      q++;
    }
    if (q >= n) {
      if (pieces === null) return [text.slice(pos, n), n, T_EOF];
      pieces.push(text.slice(p, n));
      return [pieces.join(''), n, T_EOF];
    }
    const ch = text.charCodeAt(q);
    if (ch === 44) {
      if (pieces === null) return [text.slice(pos, q), q, T_COMMA];
      pieces.push(text.slice(p, q));
      return [pieces.join(''), q, T_COMMA];
    }
    if (ch === 10) {
      if (pieces === null) return [text.slice(pos, q), q, T_LF];
      pieces.push(text.slice(p, q));
      return [pieces.join(''), q, T_LF];
    }
    // ch === 13: CRLF terminates the field at the CR.
    if (q + 1 < n && text.charCodeAt(q + 1) === 10) {
      if (pieces === null) return [text.slice(pos, q), q, T_CRLF];
      pieces.push(text.slice(p, q));
      return [pieces.join(''), q, T_CRLF];
    }
    // Lone CR: drop it, record the error, and keep scanning the field.
    errors.push({ code: 'stray_cr', line: errLine, row: errRow });
    if (pieces === null) pieces = [text.slice(p, q)];
    else pieces.push(text.slice(p, q));
    p = q + 1;
  }
}

export function run(input) {
  const text = input.text;
  const header = input.header === true;
  const n = text.length;
  let i = 0;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1;
  let line = 1;
  const errors = [];
  const records = [];
  let width = 0;
  // A lone CR dropped at a record boundary, with no line break since: the
  // record's first field then reads as unquoted even when it opens with a
  // quote (the CR is the field's first character, so the quote is a literal
  // character of it). Cleared by an empty line, and once the first field of
  // the next record has been read.
  let boundaryCR = false;

  while (i < n) {
    // ---- record boundary: skip empty lines, drop lone CRs ----
    const c0 = text.charCodeAt(i);
    if (c0 === 10) {
      i++;
      line++;
      boundaryCR = false;
      continue;
    }
    if (c0 === 13) {
      if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
        i += 2;
        line++;
        boundaryCR = false;
        continue;
      }
      // Lone CR at a boundary: dropped, attributed to the next record.
      errors.push({ code: 'stray_cr', line, row: nextRow(records.length, header) });
      i++;
      boundaryCR = true;
      continue;
    }

    // ---- one record ----
    const recLine = line;
    const recRow = nextRow(records.length, header);
    const fields = [];
    let firstField = true;

    for (;;) {
      // ---- one field ----
      let value;
      let term;
      // A quote opens a quoted field only when it is the field's first
      // character. A field that starts with a lone CR (dropped at a record
      // boundary, or at the field's own start after a comma) reads as
      // unquoted, so a quote after the CR is a literal character.
      if (text.charCodeAt(i) === 34 && !(firstField && boundaryCR)) {
        // Quoted field: find its closing quote ("" inside is one quote).
        const open = i;
        let pos = i + 1;
        let close = -1;
        let hasEsc = false;
        for (;;) {
          const q = text.indexOf('"', pos);
          if (q === -1) break;
          if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
            hasEsc = true;
            pos = q + 2;
            continue;
          }
          close = q;
          break;
        }
        if (close === -1) {
          // No closing quote: the quote is a literal character and the
          // text after it is read again as unquoted. The error is emitted
          // before the re-read.
          errors.push({ code: 'unterminated_quote', line: recLine, row: recRow });
          const scanned = scanField(text, n, open + 1, errors, recLine, recRow);
          value = '"' + scanned[0];
          i = scanned[1];
          term = scanned[2];
        } else {
          // The quoted value: a slice unless it holds "" escapes or CRs.
          const rCR = text.indexOf('\r', open + 1);
          const hasCR = rCR !== -1 && rCR < close;
          const rNL = text.indexOf('\n', open + 1);
          const hasNL = rNL !== -1 && rNL < close;
          if (hasCR || hasNL) line += countBreaks(text, open + 1, close);
          let qval;
          if (!hasCR && !hasNL) {
            qval = hasEsc
              ? text.slice(open + 1, close).replace(DQ_RE, '"')
              : text.slice(open + 1, close);
          } else {
            let v = text.slice(open + 1, close);
            if (hasEsc) v = v.replace(DQ_RE, '"');
            if (hasCR) v = v.replace(CR_RE, '\n');
            qval = v;
          }
          // Junk after the closing quote, up to the next comma or line
          // break, is appended as it stands (lone CRs in it are dropped).
          const junk = scanField(text, n, close + 1, errors, recLine, recRow);
          if (junk[0].length > 0) {
            value = qval + junk[0];
            errors.push({ code: 'quote_junk', line: recLine, row: recRow });
          } else {
            value = qval;
          }
          i = junk[1];
          term = junk[2];
        }
      } else {
        // Unquoted field.
        const scanned = scanField(text, n, i, errors, recLine, recRow);
        value = scanned[0];
        i = scanned[1];
        term = scanned[2];
      }
      fields.push(value);
      firstField = false;
      boundaryCR = false;

      // ---- field terminator ----
      if (term === T_COMMA) {
        i++;
        if (i >= n) {
          // A comma at EOF leaves one trailing empty field.
          fields.push('');
          break;
        }
        continue;
      }
      if (term === T_LF) {
        i++;
        line++;
      } else if (term === T_CRLF) {
        i += 2;
        line++;
      }
      break; // LF, CRLF or EOF ends the record.
    }

    // ---- width normalisation, short/long row errors at record end ----
    if (records.length === 0) {
      width = fields.length;
    } else if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      const extra = fields.splice(width);
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra });
    }
    records.push(fields);
  }

  // ---- assemble the answer ----
  let columns;
  let rows;
  if (header) {
    columns = records.length === 0 ? [] : records[0];
    rows = records.slice(1);
  } else {
    columns = null;
    rows = records;
  }
  return { columns, rows, errors };
}
