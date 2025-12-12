export enum ConnectionState {
  Handshaking,
  Status,
  Login,
  Configuration,
  Play,
}

export enum From {
  Server,
  Client,
}

export enum FieldType {
  VarInt,
  VarLong,
  String,
  UUID,
  UnsignedShort,
}

export interface FieldTypeTypes {
  [FieldType.VarInt]: number;
  [FieldType.VarLong]: number;
  [FieldType.String]: string;
  [FieldType.UUID]: string;
  [FieldType.UnsignedShort]: number;
}

export interface DefinedPacket {
  id: number;
  state: ConnectionState;
  name: string;
  from: From;
  fields: Record<string, FieldType>;
}
