# Zincir üstü mumlar — ölçüm (20 Kasım 2026)

Amaç: Base ağındaki tokenize hisselerin (Coinbase, "B20", ör. NVDAc) mumlarını, başka bir servise ya da lisansa
bağlı olmadan doğrudan blokzincirdeki işlemlerden üretmek. Bu klasör ilk ölçümün betikleri ve sonuçlarıdır; site bu
klasörü kullanmaz. Asıl sistem iş bilgisayarında kurulacak.

## Ne yapıldı

NVDAc'nin USDC ile işlem gördüğü 5 havuzun (Aerodrome Slipstream ×2, Uniswap v3, Uniswap v4, Nami) 7 Eylül'den
20 Kasım'a kadarki bütün alım-satımları (Swap kayıtları) Base'in herkese açık bağlantısından okundu, saatlik mumlara
toplandı ve GeckoTerminal'in mumları ve işlem listesiyle karşılaştırıldı.

| Dosya | Görev |
|---|---|
| `rpc.py` | Base JSON-RPC çağrısı (publicnode), 429/5xx'te tekrar dener |
| `clock.py` | Blok numarası → saat: her 200.000 blokta gerçek blok saati, arası doğrusal |
| `fetch.py` | Havuzların Swap kayıtlarını çeker → `swaps.jsonl` (saat, havuz, $ tutar, adet, fiyat, alış/satış, tx) |
| `clean.py` | Aykırı işlem kuralı → `swaps_clean.json` |
| `analyze.py` | Havuz özetleri, işlem boyutları, fitil ölçümleri, GeckoTerminal karşılaştırması |

Çalıştırma: `python3 fetch.py && python3 clean.py && python3 analyze.py` (yalnız Python standart kütüphanesi).
NVDAc tek başına ~10 dakika, ~600 bin işlem (~150 MB).

## Sonuçlar

- **Doğruluk:** Zincirden okunan tutarlar GeckoTerminal'in işlem listesiyle birebir aynı (300 işlemde); saatler en
  fazla 1 sn farklı. Ana havuzun 702 saatlik mumunda hacim oranı 1,003; kapanış farkının ortancası %0,30 (fark
  GeckoTerminal'in USDC'yi 0,996–1,003 $ saymasından).
- **Hacim:** 7 Eylül'den beri ~566 milyon $. Saatte ortalama: ABD borsası açıkken 381 bin $, kapalıyken (hafta içi)
  356 bin $, hafta sonu 215 bin $. İşlemsiz saat yok.
- **Havuzlar birleştirilmeli:** 22 Ekim'e kadar işlemler eski Aerodrome havuzunda (309 M$), sonra yenisinde (256 M$).
  Tek havuz yetmez. Aynı dakikada havuzlar arası fiyat farkı küçük (ortanca %0,024, p90 %0,13), birleştirmek güvenli.
- **Aykırı işlemler:** İşlemlerin ~%0,055'i (328 adet, toplam ~91 bin $) o anki fiyattan çok uzakta gerçekleşiyor ve
  ham mumlarda 100 $'a, 233 $'a uzanan sahte fitiller çiziyor. Kural: bir işlem, çevresindeki 20 işlemin (≥100 $)
  ortanca fiyatından %1,5'ten fazla uzaksa mumun en yüksek/en düşüğünü belirlemez. Gerçek bir hareket ortancayı da
  kaydırdığı için silinmez. Bu kuralla saatlik mum boyu (yüksek−düşük, ortanca / p90): borsa açık %0,89 / %1,90,
  kapalı %0,61 / %1,58, hafta sonu %0,34 / %0,96.
- **Fiyat yolu:** 11 Eylül 218,6 $ → 18 Kasım 151,9 $; tek seferlik bir sıçrama (bölünme vb.) yok.
- **Gerçek hisseyle karşılaştırma** (NVDA kapanışları kullanıcının Google Finance ekranından): tokenın ABD kapanışından
  önceki 15 dakikalık hacim ağırlıklı fiyatı 11 Eylül 218,56 $ (NVDA 218,29 $, +%0,12), 18 Kasım 151,08 $ (NVDA 150,96 $,
  +%0,08). 20 Kasım borsa açılmadan önce (09:00–09:15 UTC) token 144,04 $, NVDA açılışı 143,52 $. Token hisseyi borsa
  açıkken yakından izliyor; kapalıyken kendi fiyatını buluyor ve açılışa yakın bir yerde duruyor. İki gün ve bir açılış:
  ipucu, kapsamlı ölçüm değil.

## Kısıtlar ve kararlar için notlar

- **Geçmiş derinliği:** Ücretsiz publicnode yalnız ~7 Eylül'den sonrasını veriyor (daha eskisi "archive" — kişisel
  anahtar ister). Base'in kendi `mainnet.base.org` adresi Swap kaydı okumayı reddediyor ("request limit reached").
  dRPC'nin herkese açık adresi de hata verdi. Tam geçmiş (Ağustos'tan) için anahtarlı ücretsiz bir hesap (publicnode
  kişisel anahtar, Alchemy vb.) gerekir; anahtar sohbete ya da repoya yazılmaz.
- **Blok süresi:** Base'de blok süresi sabit değil (bugün ~0,2 sn). Saat mutlaka gerçek blok başlıklarından alınmalı.
- **Havuz keşfi:** Bu ölçümde havuzlar GeckoTerminal listesinden alındı. Kalıcı sistemde havuz fabrikalarının
  "havuz açıldı" kayıtlarından otomatik bulunmalı (yeni havuzlar açılıyor: Nami 13 Kasım, Uniswap v4 2 Kasım).
- **Uniswap v4:** Havuzun kendi adresi yok; işlemler PoolManager'dan havuz kimliğiyle süzülür ve tutarlar ters
  işaretlidir (`fetch.py`).
- **Kapsam dışı kalanlar:** WETH ve diğer çiftlerle yapılan işlemler alınmadı (USDC hacmin çoğu). İşlemler tek tek
  aykırı kuralıyla ayıklandı; 1D/1W mumları, havuz keşfi ve sürekli güncelleme henüz yazılmadı.

Grafik: `nvdac-1h-clean.png` (son 7 gün, 1H; gri fitil ham veri, renkli mum aykırı işlemler ayıklanmış).
