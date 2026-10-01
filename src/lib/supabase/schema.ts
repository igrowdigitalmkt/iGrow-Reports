export type SupabaseLikeError = {
  code?: string | null;
  message?: string | null;
};

const missingSchemaCodes = new Set([
  "42P01", // undefined_table
  "42883", // undefined_function
  "PGRST202", // function absent from schema cache
  "PGRST205", // table absent from schema cache
]);

export function isMissingSchemaError(error: SupabaseLikeError | null | undefined) {
  if (!error) return false;
  if (error.code && missingSchemaCodes.has(error.code)) return true;

  const message = (error.message ?? "").toLocaleLowerCase("en-US");
  return (
    message.includes("could not find the function") ||
    message.includes("could not find the table") ||
    message.includes("does not exist")
  );
}
