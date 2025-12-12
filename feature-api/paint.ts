export enum NamedTextColor {
  green = 'green',
  gray = 'gray',
  white = 'white',
  yellow = 'yellow',
  red = 'red',
  blue = 'blue',
  darkGray = 'darkGray',
  reset = 'reset',
}

export enum TextDecoration {
  bold = 'bold',
  italic = 'italic',
  underline = 'underline',
}

interface PaintState {
  color?: NamedTextColor;
  decorations?: TextDecoration[];
}

export const colorMapping = {
  [NamedTextColor.green]: '§a',
  [NamedTextColor.gray]: '§7',
  [NamedTextColor.white]: '§f',
  [NamedTextColor.yellow]: '§e',
  [NamedTextColor.red]: '§c',
  [NamedTextColor.blue]: '§9',
  [NamedTextColor.darkGray]: '§8',
  [NamedTextColor.reset]: '§r',
};

export const decorationMapping = {
  [TextDecoration.bold]: '§l',
  [TextDecoration.italic]: '§o',
  [TextDecoration.underline]: '§n',
};

export const terminalMapping = {
  [colorMapping[NamedTextColor.green]]: '\x1b[32m',
  [colorMapping[NamedTextColor.gray]]: '\x1b[37m',
  [colorMapping[NamedTextColor.white]]: '\x1b[37m',
  [colorMapping[NamedTextColor.yellow]]: '\x1b[33m',
  [colorMapping[NamedTextColor.red]]: '\x1b[31m',
  [colorMapping[NamedTextColor.blue]]: '\x1b[34m',
  [colorMapping[NamedTextColor.reset]]: '\x1b[0m',
  [decorationMapping[TextDecoration.bold]]: '\x1b[1m',
  [decorationMapping[TextDecoration.italic]]: '\x1b[3m',
  [decorationMapping[TextDecoration.underline]]: '\x1b[4m',
};

const nbtColorMapping: Record<NamedTextColor, string | undefined> = {
  [NamedTextColor.green]: 'green',
  [NamedTextColor.gray]: 'gray',
  [NamedTextColor.white]: 'white',
  [NamedTextColor.yellow]: 'yellow',
  [NamedTextColor.red]: 'red',
  [NamedTextColor.blue]: 'blue',
  [NamedTextColor.darkGray]: 'dark_gray',
  [NamedTextColor.reset]: undefined,
};

export class Paint {
  toTerminal() {
    let result = this.toLegacyString();
    for (const [key, value] of Object.entries(terminalMapping)) {
      result = result.replaceAll(key, value);
    }

    return result;
  }
  constructor(
    private color: NamedTextColor | undefined,
    private decorations: TextDecoration[] | undefined,
    private content: any[]
  ) {}

  toNbtObject(): any {
    const parts: any[] = [];

    for (const item of this.content) {
      if (item instanceof Paint) {
        const nestedContent = item.toNbtObject();

        if (nestedContent.text !== undefined || nestedContent.extra !== undefined) {
          parts.push(nestedContent);
        }
      } else if (item !== undefined && item !== null && item !== '') {
        parts.push({ text: String(item) });
      }
    }

    if (parts.length === 0) {
      return { text: '' };
    }

    if (parts.length === 1) {
      const singlePart = parts[0];
      if (this.color && nbtColorMapping[this.color]) {
        singlePart.color = nbtColorMapping[this.color];
      }
      if (this.decorations) {
        if (this.decorations.includes(TextDecoration.bold)) singlePart.bold = true;
        if (this.decorations.includes(TextDecoration.italic)) singlePart.italic = true;
        if (this.decorations.includes(TextDecoration.underline)) singlePart.underlined = true;
      }
      return singlePart;
    }

    const result: any = { text: '', extra: parts };

    if (this.color && nbtColorMapping[this.color]) {
      result.color = nbtColorMapping[this.color];
    }
    if (this.decorations) {
      if (this.decorations.includes(TextDecoration.bold)) result.bold = true;
      if (this.decorations.includes(TextDecoration.italic)) result.italic = true;
      if (this.decorations.includes(TextDecoration.underline)) result.underlined = true;
    }

    return result;
  }

  toString(): string {
    const nbtObj = this.toNbtObject();
    return JSON.stringify(nbtObj);
  }

  toLegacyString(): string {
    let result = '';
    let currentFormatting = '';

    if (this.color) {
      currentFormatting += colorMapping[this.color];
    }
    for (const decoration of this.decorations ?? []) {
      currentFormatting += decorationMapping[decoration];
    }

    if (currentFormatting) {
      result += currentFormatting;
    }

    for (let i = 0; i < this.content.length; i++) {
      const item = this.content[i];

      if (item instanceof Paint) {
        result += item.toLegacyString();

        if (i < this.content.length - 1) {
          if (item.color || (item.decorations && item.decorations.length > 0)) {
            result += '§r';

            if (currentFormatting) {
              result += currentFormatting;
            }
          }
        }
      } else {
        result += item;
      }
    }

    return result;
  }

  toUnformatted(): string {
    return this.content.map((value) => (value instanceof Paint ? value.toUnformatted() : value)).join('');
  }
}

type PaintBuilderFunction = (strings: TemplateStringsArray | any, ...values: any[]) => Paint;
type PaintBuilder<O extends string | number | symbol = never> = PaintBuilderFunction & {
  [key in keyof Omit<typeof TextDecoration, O>]: PaintBuilder<O | keyof typeof TextDecoration>;
} & {
  [key in keyof Omit<typeof NamedTextColor, O>]: PaintBuilder<O | keyof typeof NamedTextColor>;
};

const paintBuilder = (paint?: PaintState) =>
  new Proxy(
    ((strings, ...values) => {
      if (!Array.isArray(strings)) {
        return new Paint(paint?.color, paint?.decorations, [strings]);
      }

      return new Paint(
        paint?.color,
        paint?.decorations,
        strings.flatMap((str, i) => {
          return values.length > i ? [str, values[i]] : str;
        })
      );
    }) as PaintBuilderFunction,
    {
      get(_, p) {
        if (p in TextDecoration) {
          return paintBuilder({
            ...paint,
            decorations: [...(paint?.decorations ?? []), TextDecoration[p as keyof typeof TextDecoration]],
          });
        }

        if (p in NamedTextColor) {
          return paintBuilder({
            ...paint,
            color: NamedTextColor[p as keyof typeof NamedTextColor],
          });
        }

        if (p === 'error') {
          return (strings: TemplateStringsArray | any, ...values: any[]) => {
            const contentPaint = paintBuilder({ color: NamedTextColor.gray })(strings, ...values);

            return new Paint(undefined, undefined, [new Paint(NamedTextColor.red, [TextDecoration.bold], ['ERROR']), ' ', contentPaint]);
          };
        }

        if (p === 'success') {
          return (strings: TemplateStringsArray | any, ...values: any[]) => {
            const contentPaint = paintBuilder({ color: NamedTextColor.gray })(strings, ...values);

            return new Paint(undefined, undefined, [new Paint(NamedTextColor.green, [TextDecoration.bold], ['SUCCESS']), ' ', contentPaint]);
          };
        }

        if (p === 'usage') {
          return (strings: TemplateStringsArray | any, ...values: any[]) => {
            const usagePaint = paintBuilder()(strings, ...values);
            const content = usagePaint.toUnformatted();
            return new Paint(undefined, undefined, [`§b§lUSAGE §7${content}`]);
          };
        }

        throw new Error(`Unknown property: ${String(p)}`);
      },
    }
  ) as any as PaintBuilder;

const paint = paintBuilder() as PaintBuilder & {
  error: PaintBuilderFunction;
  success: PaintBuilderFunction;
  usage: PaintBuilderFunction;
};

export default paint;
