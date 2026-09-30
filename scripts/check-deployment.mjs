import { validateDeployment } from "./deployment-config.mjs";

const errors = validateDeployment(process.env);
if (errors.length) {
  console.error("Publicação bloqueada por configuração incompleta:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Configuração de publicação aprovada. Conectividade, migrations e login ainda exigem homologação no Supabase.");
}
