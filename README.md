# Trading system

Kendi kendine çalışan, demo modlu çok piyasalı trading sistemi.

- `engine/`: saf TypeScript motor (Node testleri ve Supabase Edge Function aynı kodu kullanır)
  - `strategies/core.ts`: uzun vade, %70, geniş ETF'ler, hedef ağırlığa dengeleme
  - `strategies/swing.ts`: orta vade, %20, momentum + trend + yapay zeka skoru, haftalık
  - `strategies/tactical.ts`: kısa vade, %10, kripto ve hızlı hisselerde trend takibi, sıkı stop
  - `risk.ts`: zarar durdur, iz süren stop, günlük zarar limiti, zirveden düşüş freni, asgari emir tutarı
  - `cycle.ts`: tek tik; demoda sanal işlem yapar, gerçek modda sadece onaya sunar
  - `backtest.ts`: geçmiş veride aynı motoru gün gün çalıştırır
- `supabase/`: veritabanı şeması, 15 dakikada bir çalışan `engine-tick` fonksiyonu ve zamanlayıcı

Komutlar: `npm test`, `npm run typecheck`, `npm run backtest -- 5y`

## Canlı kurulum (Supabase, proje `dljsznnfhyigjonojvfl`, Frankfurt)

- `engine-tick` fonksiyonu pg_cron ile her 15 dakikada çalışır; stratejiler günde bir kez 15:00 UTC sonrası çalışır.
- Geçmiş test: `select public.call_function('engine-tick', '{"action":"backtest","range":"5y"}');` sonuç `backtest_runs` tablosuna yazılır.
- Fonksiyonu güncellemeden önce `scripts/prepare-functions.sh` motoru fonksiyon klasörüne kopyalar.

## Web paneli (`panel/`)

Vite + React. Veriyi `panel-api` Edge Function'dan alır (şifreli giriş, ilk kurulumda tek kullanımlık kod). Vercel'de `panel` klasöründen yayınlanır.
