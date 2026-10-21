/** Error raised by an operation for invalid arguments. Kept in its own module so the importer helpers and the registry can share it. */
export class OpError extends Error {
  constructor(message: string) { super(message); this.name = 'OpError'; }
}
export const fail = (m: string): never => { throw new OpError(m); };
