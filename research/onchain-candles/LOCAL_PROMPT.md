# Yerel Claude Code oturumu için prompt (iş bilgisayarı, 23 Kasım 2026)

Aşağıdaki metni iş bilgisayarında, analiz motorunun (CryptoMarketMap) reposunda açılan Claude Code oturumuna
olduğu gibi yapıştırın.

---

Merhaba. Bugün tokenize ABD hisseleri (Base ağı, Coinbase'in "B20" tokenları: NVDAc, AAPLc…) için **kendi zincir
üstü mum sistemimizi** kuracağız. Ben yazılımcı değilim; açıklamaları Türkçe, sade ve terimleri tanımlayarak yap.
Sırları (RPC anahtarı vb.) hiçbir dosyaya commit'leme, sohbete yazdırma.

## Bağlam

- Bu repo analiz motoru ve mum yükleyicisi. Binance mumlarını R2'ye (`data.marketlevelmap.com/candles/...`)
  `marketlevelmap-candles-v1` biçiminde yüklüyor. Site (marketlevelmap-web reposu) ve motor bu dosyaları okuyor.
- Amaç: tokenize hisselerin mumlarını **hiçbir servise / lisansa bağlı olmadan** doğrudan blokzincirdeki Swap
  kayıtlarından üretmek ve aynı biçimde yazmak. GeckoTerminal/CoinGecko kullanılmayacak (yeniden yayın şartları
  belirsiz); onları yalnız doğrulama için kullanabilirsin.
- Önceki ölçümün betikleri ve bulguları marketlevelmap-web reposunda: `research/onchain-candles/` (README.md,
  rpc.py, clock.py, fetch.py, clean.py, analyze.py). Önce onları oku; oradaki yaklaşımı temel al.

## Ölçümden bilinenler (20–22 Kasım)

- NVDAc: `0xb20000000000000000000078ee7ce2fE4908108C` (decimals 8). USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
  (decimals 6). AAPLc: `0xb200000000000000000000C2e324d24d7eEcd1fb` (Base dokümanından; zincirde doğrula).
  Resmî liste: Base'in Tokenized Stocks API'si (docs.base.org, anahtar gerekmiyor).
- NVDAc/USDC havuzları (hepsinde token0 = USDC, token1 = NVDAc):
  Aerodrome Slipstream yeni `0xf668e21993f0acd7ab00bb1cfbaed0df28a3c8ec` (factory `0x9cb220581b91b0c83223012fe69688b92ad07a76`, 22 Ekim'den beri ana havuz),
  Aerodrome Slipstream eski `0x853f5f1b92b16714fe6cda67caad0856b83c7ab9` (factory `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef`, 22 Ekim'e kadar ana havuz),
  Uniswap v3 `0x60661b315553eb81872deea9a66d567cf0ccd33b` (factory `0x33128a8fC17869897dcE68Ed026d694621f6FDfD`),
  Nami `0x337bea70489cd71a8c3951c1aa49c637b4b9b122` (factory `0xf4502a98a15e82d66d28d2381e2f3a407ea45b83`),
  Uniswap v4 havuz kimliği `0xc8c52ec416fe9d3b6e70a2e4ccde7cece3b8318d109a1aa1bbc7e0980c4fe985` (PoolManager `0x498581ff718922c3f8e6a244956af099b2652b2b`).
- Swap kaydı: v3 / Slipstream topic `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`
  (amount0, amount1 havuzun gözünden, + = havuza giren). v4 topic `0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f`,
  topic[1] = havuz kimliği, tutarların işareti ters.
- Base'de blok süresi sabit değil (bugün ~0,2 sn). Saati blok numarasından tahmin etme; gerçek blok başlıklarından al
  (aralıklı çapa + doğrusal ara değer yeterli, ölçümde hata ≤1 sn).
- RPC: `mainnet.base.org` Swap kaydı okumayı reddediyor; ücretsiz publicnode yalnız ~7 Eylül'den sonrasını veriyor.
  Tam geçmiş (Ağustos 2026'dan) için anahtarlı bir RPC gerekiyor (Alchemy, publicnode kişisel anahtar vb.). Anahtarı
  ben bir `.env` dosyasına koyacağım; `.gitignore`'da olduğundan emin ol, yoksa ekle.
- Ölçüm sonuçları: GeckoTerminal'in işlem listesiyle tutarlar birebir; saatlik hacim oranı 1,003. Havuzlar arası
  aynı dakika fiyat farkı ortanca %0,024 → havuzlar birleştirilebilir. İşlemlerin ~%0,055'i aykırı (100 $, 233 $'a
  uzanan sahte fitiller). Aykırı kural: bir işlem, çevresindeki 20 işlemin (≥100 $) ortanca fiyatından %1,5'ten fazla
  uzaksa mumun en yüksek/en düşüğünü belirlemez. Gerçek hisseyle karşılaştırma: ABD kapanışından önceki 15 dk hacim
  ağırlıklı token fiyatı NVDA kapanışından %0,08–0,12 farklı (iki gün; daha geniş ölçülmeli).

## Bugünkü işler (sırayla; her adımın sonunda bana kısa Türkçe rapor ver)

1. **Repoyu tanı.** Mum yükleyicisinin nerede olduğunu, `marketlevelmap-candles-v1` dosyalarının tam biçimini
   (satır alanları, `seedCandle`, `index.json`, `latest.json`, arşiv dosyaları, `levels.json`) ve R2'ye nasıl
   yüklendiğini bul. Zincir üstü kodu nereye koymanın doğru olacağını öner (ayrı bir modül/klasör); onayımı al.
2. **Havuz keşfi.** Verilen token için havuzları factory'lerin "havuz açıldı" kayıtlarından otomatik bul (v4 için
   PoolManager'ın Initialize kaydı). Yeni havuzlar sonradan da bulunmalı. Şimdilik yalnız USDC çiftleri.
3. **İşlemleri çek.** Swap kayıtlarını aralık aralık çek (hata/limit olunca aralığı böl, tekrar dene), gerçek blok
   saatleriyle zamanla, yerel bir dosyaya/veritabanına kaydet. Kaldığı yerden devam edebilsin (her seferinde baştan
   çekmesin).
4. **Mum üret.** Tüm havuzları birleştir, aykırı kuralı uygula, 1H mum üret; 4H, 1D, 1W'yi 1H'den türet (UTC;
   1W pazartesi 00:00 UTC). İşlemsiz saat olursa ne yapılacağını bana sor. Hacim USDC cinsinden.
5. **Doğrula (önce ölç).** NVDAc ve AAPLc için: (a) GeckoTerminal'in saatlik mumlarıyla karşılaştırma (ana havuz),
   (b) ABD borsası kapanışlarıyla günlük karşılaştırma (tüm dönem; hisse verisini nereden alacağımızı bana sor),
   (c) aykırı kuralının kaç işlemi elediği. Sonuçları rakamlarla ve bir grafik görseliyle göster. Küçük örneklem ya
   da aynı veriye bakılarak seçilmiş kural varsa "ipucu, kanıt değil" diye belirt.
6. **Dosyaları yaz (yükleme yok).** Mumları `marketlevelmap-candles-v1` biçiminde yerel bir klasöre yaz. Sembol adı
   için öneri getir (sitede sembol `^[A-Z0-9]{2,20}$` olmalı; küçük harfli "c" sorun). `source` alanına zincir üstü
   kaynak olduğunu yaz. R2'ye yüklemeyi ben onaylamadan yapma.
7. **Motorda deneme.** Motor bu dosyaları okuyabiliyor mu? Gerekirse ne değişmeli, söyle; bir sembolde dene.

## Ek küçük iş (vakit kalırsa, ayrı commit)

Binance mumlarını yüklerken Binance kline'ındaki **taker buy volume** (alan 9; quote karşılığı alan 10) da dosyalara
yazılsın. Sitedeki mum başına delta/CVD özelliği bunu kullanacak. Mevcut alan sırasını bozma; yeni alanı sona ekle
ve biçim notunu güncelle. Site tarafı ayrı bir işte uyarlanacak.

## Kurallar

- Davranış değiştiren her iş test içersin. Commit mesajları açıklayıcı olsun.
- Sitedeki (marketlevelmap-web) hiçbir şeye bu oturumda dokunma; site entegrasyonu ayrı iş.
- Kötü sonuç açıkça söylenir; denenmemiş şey "denenmedi" diye yazılır.
