export const RUNTIME_INSTANCE_ID = [
  process.pid.toString(36),
  Date.now().toString(36),
  Math.random().toString(36).slice(2, 8),
].join('-')

