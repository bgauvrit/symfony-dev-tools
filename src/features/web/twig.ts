interface OffsetRange {
  start: number;
  end: number;
}

export interface TwigRouteCall {
  functionName: 'path' | 'url';
  callRange: OffsetRange;
  routeName?: string;
  routeNameRange?: OffsetRange;
  quote?: '\'' | '"';
  paramsObjectRange?: OffsetRange;
  existingParamKeys: string[];
}

export interface TwigIdentifierSegment {
  value: string;
  range: OffsetRange;
}

export interface TwigIdentifierChain {
  value: string;
  range: OffsetRange;
  segments: TwigIdentifierSegment[];
}

const TWIG_ROUTE_FUNCTION_PATTERN = /\b(path|url)\s*\(/g;

export function parseTwigRouteCalls(text: string): TwigRouteCall[] {
  const calls: TwigRouteCall[] = [];
  let match: RegExpExecArray | null;

  while ((match = TWIG_ROUTE_FUNCTION_PATTERN.exec(text)) !== null) {
    const functionName = match[1] as 'path' | 'url';
    const openParenIndex = text.indexOf('(', match.index);
    const closeParenIndex = findMatchingDelimiter(text, openParenIndex, '(', ')');

    if (openParenIndex === -1 || closeParenIndex === -1) {
      continue;
    }

    const parsedCall = parseTwigRouteCall(text, functionName, openParenIndex, closeParenIndex);

    if (parsedCall) {
      calls.push(parsedCall);
    }
  }

  return calls;
}

export function findTwigRouteCallAt(text: string, offset: number): TwigRouteCall | undefined {
  return parseTwigRouteCalls(text).find(
    (call) => offset >= call.callRange.start && offset <= call.callRange.end,
  );
}

export function findTwigIdentifierChainAt(text: string, offset: number): TwigIdentifierChain | undefined {
  if (text.length === 0) {
    return undefined;
  }

  let anchor = offset;

  if (anchor >= text.length) {
    anchor = text.length - 1;
  }

  if (!isIdentifierChainChar(text.charAt(anchor)) && anchor > 0 && isIdentifierChainChar(text.charAt(anchor - 1))) {
    anchor -= 1;
  }

  if (!isIdentifierChainChar(text.charAt(anchor))) {
    return undefined;
  }

  let start = anchor;
  let end = anchor + 1;

  while (start > 0 && isIdentifierChainChar(text.charAt(start - 1))) {
    start -= 1;
  }

  while (end < text.length && isIdentifierChainChar(text.charAt(end))) {
    end += 1;
  }

  const value = text.slice(start, end);

  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(value)) {
    return undefined;
  }

  const segments: TwigIdentifierSegment[] = [];
  let cursor = start;

  for (const segmentValue of value.split('.')) {
    segments.push({
      value: segmentValue,
      range: {
        start: cursor,
        end: cursor + segmentValue.length,
      },
    });
    cursor += segmentValue.length + 1;
  }

  return {
    value,
    range: {
      start,
      end,
    },
    segments,
  };
}

function parseTwigRouteCall(
  text: string,
  functionName: 'path' | 'url',
  openParenIndex: number,
  closeParenIndex: number,
): TwigRouteCall | undefined {
  let cursor = skipWhitespace(text, openParenIndex + 1);
  const routeLiteral = parseStringLiteral(text, cursor);

  if (!routeLiteral) {
    return {
      functionName,
      callRange: {
        start: openParenIndex,
        end: closeParenIndex + 1,
      },
      existingParamKeys: [],
    };
  }

  cursor = routeLiteral.closingQuoteIndex === undefined
    ? routeLiteral.range.end
    : skipWhitespace(text, routeLiteral.closingQuoteIndex + 1);

  let paramsObjectRange: OffsetRange | undefined;

  if (text.charAt(cursor) === ',') {
    cursor = skipWhitespace(text, cursor + 1);

    if (text.charAt(cursor) === '{') {
      const objectEnd = findMatchingDelimiter(text, cursor, '{', '}');

      if (objectEnd !== -1) {
        paramsObjectRange = {
          start: cursor,
          end: objectEnd + 1,
        };
      }
    }
  }

  const existingParamKeys = paramsObjectRange
    ? extractTwigObjectKeys(text.slice(paramsObjectRange.start + 1, paramsObjectRange.end - 1))
    : [];

  return {
    functionName,
    callRange: {
      start: openParenIndex,
      end: closeParenIndex + 1,
    },
    routeName: routeLiteral.value,
    routeNameRange: routeLiteral.range,
    quote: routeLiteral.quote,
    paramsObjectRange,
    existingParamKeys,
  };
}

function parseStringLiteral(
  text: string,
  startIndex: number,
): { value: string; range: OffsetRange; quote: '\'' | '"'; closingQuoteIndex?: number } | undefined {
  const quote = text.charAt(startIndex);

  if (quote !== '\'' && quote !== '"') {
    return undefined;
  }

  let cursor = startIndex + 1;

  while (cursor < text.length) {
    const current = text.charAt(cursor);

    if (current === '\\') {
      cursor += 2;
      continue;
    }

    if (current === quote) {
      return {
        value: text.slice(startIndex + 1, cursor),
        range: {
          start: startIndex + 1,
          end: cursor,
        },
        quote,
        closingQuoteIndex: cursor,
      };
    }

    cursor += 1;
  }

  return {
    value: text.slice(startIndex + 1),
    range: {
      start: startIndex + 1,
      end: text.length,
    },
    quote,
  };
}

function findMatchingDelimiter(
  text: string,
  startIndex: number,
  openCharacter: string,
  closeCharacter: string,
): number {
  let depth = 0;
  let cursor = startIndex;

  while (cursor < text.length) {
    const current = text.charAt(cursor);

    if (current === '\'' || current === '"') {
      const parsedLiteral = parseStringLiteral(text, cursor);

      if (!parsedLiteral || parsedLiteral.closingQuoteIndex === undefined) {
        return -1;
      }

      cursor = parsedLiteral.closingQuoteIndex + 1;
      continue;
    }

    if (current === openCharacter) {
      depth += 1;
    } else if (current === closeCharacter) {
      depth -= 1;

      if (depth === 0) {
        return cursor;
      }
    }

    cursor += 1;
  }

  return -1;
}

function skipWhitespace(text: string, startIndex: number): number {
  let cursor = startIndex;

  while (cursor < text.length && /\s/.test(text.charAt(cursor))) {
    cursor += 1;
  }

  return cursor;
}

function extractTwigObjectKeys(text: string): string[] {
  const keys = new Set<string>();
  const pattern = /(?:(['"])([^'"]+)\1|([A-Za-z_][A-Za-z0-9_]*))\s*:/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const key = match[2] ?? match[3];

    if (key) {
      keys.add(key);
    }
  }

  return Array.from(keys);
}

function isIdentifierChainChar(value: string): boolean {
  return /[A-Za-z0-9_.]/.test(value);
}
