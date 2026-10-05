export class SnapshotValidationError extends Error {
  constructor() {
    super("O snapshot confirmado não passou na validação.");
    this.name = "SnapshotValidationError";
  }
}
