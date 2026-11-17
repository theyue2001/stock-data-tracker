import { redirect } from "next/navigation";
import { DEFAULT_ADMIN_PATH } from "@/lib/health/admin-auth";

/** /admin has a single screen for now. */
export default function AdminIndexPage() {
  redirect(DEFAULT_ADMIN_PATH);
}
