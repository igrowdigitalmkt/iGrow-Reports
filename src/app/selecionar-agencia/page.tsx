import { redirect } from "next/navigation";

// Former address of the workspace switcher; kept so saved links keep working.
export default function LegacySelectWorkspacePage() {
  redirect("/selecionar-espaco");
}
