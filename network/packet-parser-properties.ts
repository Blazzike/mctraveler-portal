export function getParserPropertySize(parserID: number, buffer: Buffer, offset: number): number {
  let size = 0;
  let b: number;
  let shift: number;

  switch (parserID) {
    case 0:
      return 0;

    case 1:
    case 2:
    case 3:
    case 4: {
      const flags = buffer[offset] || 0;
      size = 1;
      const hasMin = (flags & 0x01) !== 0;
      const hasMax = (flags & 0x02) !== 0;

      if (parserID === 1) {
        if (hasMin) size += 4;
        if (hasMax) size += 4;
      } else if (parserID === 2) {
        if (hasMin) size += 8;
        if (hasMax) size += 8;
      } else if (parserID === 3) {
        if (hasMin) size += 4;
        if (hasMax) size += 4;
      } else if (parserID === 4) {
        if (hasMin) size += 8;
        if (hasMax) size += 8;
      }
      return size;
    }

    case 5:
      shift = 0;
      do {
        b = buffer[offset + size++] || 0;
        shift += 7;
      } while ((b & 0x80) !== 0 && size < 5);
      return size;

    case 6:
      return 1;

    case 7:
      return 0;

    case 8:
    case 9:
    case 10:
    case 11:
      return 0;

    case 12:
    case 13:
    case 14:
    case 15:
      return 0;

    case 16:
    case 17:
    case 18:
    case 19:
      return 0;

    case 20:
    case 21:
    case 22:
    case 23:
      return 0;

    case 24:
    case 25:
    case 26:
      return 0;

    case 27:
      return 0;

    case 28:
    case 29:
      return 0;

    case 30:
      return 0;

    case 31:
      return 1;

    case 32:
    case 33:
      return 0;

    case 34:
    case 35:
      return 0;

    case 36:
    case 37:
      return 0;

    case 38:
      return 0;

    case 39:
    case 40:
      return 0;

    case 41:
    case 42:
      return 0;

    case 43:
      return 4;

    case 44:
    case 45:
    case 46:
    case 47:
    case 48: {
      let strLen = 0;
      shift = 0;
      size = 0;
      do {
        b = buffer[offset + size++] || 0;
        strLen |= (b & 0x7f) << shift;
        shift += 7;
      } while ((b & 0x80) !== 0 && size < 5);
      return size + strLen;
    }

    case 49:
    case 50:
    case 51:
      return 0;

    case 52:
    case 53:
    case 54:
    case 55:
      return 0;

    case 56:
      return 0;

    default:
      console.warn(`[Parser] Unknown parser ID ${parserID}`);
      return 0;
  }
}
