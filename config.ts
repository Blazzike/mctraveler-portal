export const kPort = parseInt(process.env.PORT ?? '25565', 10);
export const kPrimaryPort = parseInt(process.env.PRIMARY_PORT ?? '25566', 10);
export const kSecondaryPort = parseInt(process.env.SECONDARY_PORT ?? '25567', 10);
export const kProtocolVersion = parseInt(process.env.PROTOCOL_VERSION ?? '773', 10);
export const kProtocolVersionString = process.env.PROTOCOL_VERSION_STRING ?? '1.21.10';
export const kIsOnlineMode = process.env.ONLINE_MODE !== 'false';
export const kIsProduction = process.env.PRODUCTION === '1' || process.env.NODE_ENV === 'production';
export const kMcMemoryMax = process.env.MC_MEMORY_MAX ?? (kIsProduction ? '8G' : '512M');
export const kMcMemoryMin = process.env.MC_MEMORY_MIN ?? (kIsProduction ? '8G' : '256M');
