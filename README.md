# SOFRA: Kargalı Şato (`sofra-oyun`)

İndirme gerektirmeyen, tarayıcıda (Bilgisayar + Android/iOS Telefon) açılan çevrim içi çok oyunculu 3D sosyal çıkarım (hain bulma) oyunu.

## 1. Windows'ta Kurulum Gereksinimleri

1. **Node.js (20 LTS veya üzeri):** [nodejs.org](https://nodejs.org/) adresinden indirip kurun.
2. **pnpm Paket Yöneticisi:** PowerShell veya CMD üzerinde şu komutu çalıştırın:
   ```powershell
   npm install -g pnpm
   ```

## 2. Bağımlılıkları Yükleme ve Çalıştırma

`OYUN HALI/sofra-oyun` dizininde terminali açıp:

```powershell
pnpm install
pnpm dev
```

- **Oyun Sunucusu (Colyseus):** `http://localhost:2567` (`ws://localhost:2567`)
- **İstemci (Vite + Three.js):** `http://localhost:5173`
- **Aynı Wi-Fi'deki Telefondan Giriş:** Bilgisayarınızın yerel IP adresiyle `http://<bilgisayar-ip>:5173` adresini telefon tarayıcısında açın.

## 3. Derleme ve Test

```powershell
pnpm build
pnpm test
```
