/**
 * İlk Developer (yönetici) hesabını oluşturur veya şifresini sıfırlar.
 *
 * Kullanım (hedef veritabanının DATABASE_URL'i .env'de veya ortamda olmalı):
 *   npm run create-admin -- ornek@firma.com "Ad Soyad"
 * Şifre ekranda sorulur (en az 10 karakter).
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

async function main() {
  const [email, name = "Sistem Yöneticisi"] = process.argv.slice(2);
  if (!email || !email.includes("@")) {
    console.error('Kullanım: npm run create-admin -- e-posta@ornek.com "Ad Soyad"');
    process.exit(1);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const password = (process.env.ADMIN_PASSWORD ?? (await rl.question("Şifre (en az 10 karakter): "))).trim();
  rl.close();
  if (password.length < 10) {
    console.error("Şifre en az 10 karakter olmalı.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: { passwordHash, role: "DEVELOPER", active: true },
    create: { email: email.toLowerCase(), name, passwordHash, role: "DEVELOPER" },
  });
  console.log(`Developer hesabı hazır: ${user.email}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
