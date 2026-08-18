import { NextResponse } from 'next/server';
import { badRequest, handle, notFound, readJson, requireUser } from '@/lib/http';
import { updateDb } from '@/lib/db';
import { genTempPassword, hashPassword } from '@/lib/password';
import { publicAccount } from '@/lib/session';

interface PatchBody {
  active?: boolean;
  resetPassword?: boolean;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ username: string }> }) {
  return handle(async () => {
    const admin = await requireUser('admin');
    const key = decodeURIComponent((await ctx.params).username).toLowerCase();
    const { active, resetPassword } = await readJson<PatchBody>(req);

    if (active === false && key === admin.username.toLowerCase()) {
      badRequest("You can't deactivate your own account.");
    }

    const newPassword = resetPassword ? genTempPassword() : null;
    const passwordHash = newPassword ? await hashPassword(newPassword) : null;

    // Both changes land in one write, so an admin resetting a password on a
    // deactivated account can't end up with half of the change applied.
    const account = await updateDb((d) => {
      const existing = d.accounts[key];
      if (!existing) return null;
      if (typeof active === 'boolean') existing.active = active;
      if (passwordHash) existing.passwordHash = passwordHash;
      return publicAccount(existing);
    });
    if (!account) notFound('Account not found.');

    return NextResponse.json({ account, password: newPassword || undefined });
  });
}
