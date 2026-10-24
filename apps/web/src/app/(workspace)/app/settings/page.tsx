"use client";

import { Loader2, LogOut } from "lucide-react";
import { useId, useState } from "react";
import { InlineError } from "@/components/dashboard/states";
import { useWorkspace } from "@/components/dashboard/workspace-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, CardTitle, Input, Label, PageHeader } from "@/components/ui/primitives";
import { ApiError, api } from "@/lib/api/client";

const ROLE_HELP = { OWNER: "View, import and publish", ANALYST: "View and import", VIEWER: "View published data" } as const;

export default function SettingsPage() {
  const { me, signOut } = useWorkspace();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <>
      <PageHeader title="Settings" description="Your account, organization memberships and session." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardBody>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted">Name</dt><dd className="text-text">{me.displayName}</dd>
              <dt className="text-muted">Email</dt><dd className="break-all text-text">{me.email}</dd>
              <dt className="text-muted">User ID</dt><dd className="tabular break-all text-xs text-muted">{me.id}</dd>
            </dl>
            <p className="mt-4 text-xs text-muted">Profile changes are not available in the API yet; ask an administrator.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Organizations</CardTitle></CardHeader>
          <CardBody className="overflow-x-auto px-0">
            <table className="w-full text-sm">
              <caption className="sr-only">Your organization memberships and roles</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                  <th scope="col" className="px-5 py-2 font-medium">Organization</th>
                  <th scope="col" className="px-5 py-2 font-medium">Role</th>
                  <th scope="col" className="px-5 py-2 font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {me.memberships.map((m) => (
                  <tr key={m.organizationId} className="border-b border-border/70 last:border-0">
                    <td className="px-5 py-2.5"><span className="font-medium text-text">{m.organizationName}</span><span className="block text-xs text-muted">{m.organizationSlug}</span></td>
                    <td className="px-5 py-2.5"><Badge tone={m.role === "OWNER" ? "accent" : "neutral"}>{m.role}</Badge><span className="block pt-1 text-xs text-muted">{ROLE_HELP[m.role]}</span></td>
                    <td className="px-5 py-2.5">{m.dataClassification === "SYNTHETIC" ? <Badge tone="accent">Synthetic</Badge> : <Badge>Production</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <ChangePasswordCard />

        <Card>
          <CardHeader><CardTitle>Session</CardTitle></CardHeader>
          <CardBody className="space-y-4 text-sm">
            <p className="text-muted">Signing out revokes this session on the server immediately. Your tokens are kept in secure, HttpOnly cookies that page scripts cannot read.</p>
            <Button variant="secondary" disabled={signingOut} onClick={async () => { setSigningOut(true); await signOut(); }}>
              {signingOut ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />} Sign out
            </Button>
            <div className="rounded-xl border border-dashed border-border p-3 text-xs text-muted">
              <span className="font-medium text-text">Active sessions list — unavailable.</span> The backend enforces a session limit and records devices,
              but has no HTTP endpoint to list or revoke other sessions yet. Changing your password signs out all other sessions.
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function ChangePasswordCard() {
  const ids = { current: useId(), next: useId(), confirm: useId(), hint: useId() };
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const current = String(data.get("current") ?? "");
    const next = String(data.get("next") ?? "");
    const confirm = String(data.get("confirm") ?? "");
    const problems: string[] = [];
    if (next.length < 12) problems.push("The new password must have at least 12 characters.");
    if (next !== confirm) problems.push("The new passwords do not match.");
    if (next && next === current) problems.push("The new password must differ from the current one.");
    setErrors(problems);
    setDone(false);
    if (problems.length) return;
    setPending(true);
    try {
      await api.changePassword(current, next);
      form.reset();
      setDone(true);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError("unavailable", 0, ["Password change failed"]);
      setErrors(apiErr.kind === "forbidden" ? ["The current password is incorrect."] : apiErr.messages);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Change password</CardTitle></CardHeader>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <div className="space-y-1.5"><Label htmlFor={ids.current}>Current password</Label><Input id={ids.current} name="current" type="password" autoComplete="current-password" required maxLength={128} /></div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.next}>New password</Label>
            <Input id={ids.next} name="next" type="password" autoComplete="new-password" required minLength={12} maxLength={128} aria-describedby={ids.hint} />
            <p id={ids.hint} className="text-xs text-muted">12–128 characters. A long passphrase is best; the server also rejects common words and your e-mail name.</p>
          </div>
          <div className="space-y-1.5"><Label htmlFor={ids.confirm}>Confirm new password</Label><Input id={ids.confirm} name="confirm" type="password" autoComplete="new-password" required maxLength={128} /></div>
          <InlineError messages={errors} />
          {done ? <p role="status" className="rounded-xl bg-success-bg px-4 py-3 text-sm text-success">Password changed. All your other sessions were signed out.</p> : null}
          <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" aria-hidden /> : null}{pending ? "Saving…" : "Change password"}</Button>
        </form>
      </CardBody>
    </Card>
  );
}
