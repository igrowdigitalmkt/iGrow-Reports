export const META_LOGIN_APP_ID = "28432983606382926";
export const META_LOGIN_CONFIG_ID = "1662561831866536";

export function selectedMetaAccounts<T extends { id: string }>(accounts: T[], selected?: string[]) {
  if (!selected) return accounts;
  const ids = new Set(selected);
  if (!ids.size || ids.size !== selected.length || selected.some(id => !accounts.some(account => account.id === id))) {
    throw new Error("Seleção de contas inválida ou acesso removido na Meta.");
  }
  return accounts.filter(account => ids.has(account.id));
}
