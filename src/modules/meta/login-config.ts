export const META_LOGIN_APP_ID = "1403140724038533";
export const META_LOGIN_CONFIG_ID = "1103854562383352";

export function selectedMetaAccounts<T extends { id: string }>(accounts: T[], selected?: string[]) {
  if (!selected) return accounts;
  const ids = new Set(selected);
  if (!ids.size || ids.size !== selected.length || selected.some(id => !accounts.some(account => account.id === id))) {
    throw new Error("Seleção de contas inválida ou acesso removido na Meta.");
  }
  return accounts.filter(account => ids.has(account.id));
}
