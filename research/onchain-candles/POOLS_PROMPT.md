# Yerel oturum için ek iş: pools.json (24 Kasım 2026)

Site, tokenize hisselerin canlı fiyatını doğrudan Base'deki ana havuzdan okuyor. Hangi havuzun "ana havuz" olduğunu
yerel program biliyor (havuz keşfi), site bilmiyor. Bu yüzden mumlarla birlikte her token için küçük bir dosya yaz.

**Dosya:** `candles/<PAIR>/pools.json` (ör. `candles/NVDACUSDC/pools.json`), mumlarla aynı yüklemede.

```json
{
  "schemaVersion": "marketlevelmap-onchain-pools-v1",
  "pair": "NVDACUSDC",
  "chainId": 8453,
  "token": { "address": "0xb20000000000000000000078ee7ce2fE4908108C", "decimals": 8 },
  "quote": { "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "decimals": 6, "symbol": "USDC" },
  "pools": [
    { "address": "0xf668e21993f0acd7ab00bb1cfbaed0df28a3c8ec", "kind": "v3", "venue": "aerodrome-slipstream" }
  ],
  "updatedAt": "2026-11-24T12:00:00Z"
}
```

**Kurallar:**
1. `pools` sırası önemli: ilk havuz **ana havuz**. Ana havuz, son 7 günde en çok USDC hacmi olan havuzdur. En fazla 3 havuz yaz.
2. `kind: "v3"` yalnız `slot0()` fonksiyonu olan havuzlar içindir: Uniswap v3 ve Aerodrome Slipstream gibi kopyaları.
   - Uniswap v4 havuzlarını şimdilik yazma; site onları okuyamıyor.
   - Nami havuzunda `slot0()` yoksa onu da yazma.
3. `decimals` alanlarını zincirden oku, elle yazma.
4. Yeni bir havuz ana havuz olursa dosya bir sonraki yüklemede güncellenir. Ayrıca bir işlem gerekmez.
5. Test ekle: dosyanın biçimi, havuz sırası (hacme göre) ve her havuzun gerçekten `slot0()` yanıtı verdiği.

## İkinci iş: ATH (ve yıllık açılış) düzeltmesi

`levels.json` → `keyLevels` içindeki `ATH` yanlış: NVDAc 328 $, AAPLc 467 $ (ikisi de 18 Ağustos, ilk gün). Gerçek NVDA
o günlerde bu seviyede değildi; büyük ihtimalle ilk günün sığ havuzlarındaki aykırı işlemler mumun en yükseğini
belirlemiş.
1. Önce nedenini bul: ilk günlerin (18–25 Ağustos) en yüksek değerlerini veren işlemleri listele; aykırı kuralı
   (çevredeki 20 işlemin ortancasından %1,5'ten uzak) bu günlerde uygulanmış mı, işlem az olduğu için zayıf mı kalmış?
2. Düzeltmeyi öner ve **onayımı al**; sonra mumları ve `levels.json`'u yeniden üret. Düzeltmeden sonra ATH'yi
   gerçek NVDA / AAPL grafiğiyle karşılaştır (rakam ve tarih).
3. `YO` şu an ilk mumun açılışı (18 Ağustos), gerçek yıl başı değil. Veri yıl başından başlamadığı için `YO`'yu
   tokenlerde hiç yazma (ya da `periodStart`'ı gerçek yıl başı değilse yazma).
4. Test ekle: ilk günlerde aykırı işlemin ATH'yi belirlemediğini gösteren bir test.

Site tarafında tokenlerin yıllık açılış ve ATH sütunları şimdilik "—" gösteriliyor; düzeltme gelince açılabilir.

## Not

- NVDAc 23 Kasım 13:00 UTC mumundaki +%17'lik yükseliş gerçek (NVDA aynı gün ~130 → ~167 $). Dokunma.
