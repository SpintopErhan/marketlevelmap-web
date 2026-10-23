# MarketLevelMap — Kütüphane rehberi

Bu belge kütüphanenin altyapısını ve yeni formasyon ya da kavram eklerken uyulacak kuralları tarif eder. Kütüphanede iki sayfa türü vardır: **formasyon** (sabit bir düzen) ve **kavram** (esnek bölümler; bkz. 3a). Görsel tasarımın referansı, mockup canvas'taki **Kütüphane · Yutan Boğa** ve **Kütüphane · Omuz Baş Omuz** sayfalarıdır.

**Kapsam (ilk sürüm):** klasik bir kütüphane. Gerçek grafik örnekleri, motorla ve analizlerle bağlantı **yok**. Bunlar sonraki sürümde eklenecek. Veri yapısı bunlara şimdiden yer bırakır.

---

## 1. İlkeler

| İlke | Neden |
|---|---|
| Her formasyon **tek bir YAML dosyası**, iki dil aynı dosyada | Yeni formasyon eklemek = bir dosya yazmak. Diller arasında yapı ayrışmaz. |
| Sayfalar **derleme (build) sırasında statik HTML** olarak üretilir | Arama motorları içeriği doğrudan okur. Kütüphanenin trafik değeri buradan gelir. Tarayıcıda JS ile oluşturulan içerik SEO'da zayıf kalır. |
| Görseller **elle çizilmiş SVG**, metin etiketleri dile göre doldurulur | Telif riski yok, her ölçekte net, dosya boyutu küçük. |
| Al-sat dili yok, başarı oranı yok | Sitenin genel ilkesi. İçerik olasılık diliyle yazılır. |
| Tanımlar ölçülebilir yazılır | İleride motorun tespit kuralları aynı tanımlardan türetilecek. |

---

## 2. Dosya düzeni

```
content/library/
├─ patterns/<id>.yaml       # her formasyon bir dosya, iki dil aynı dosyada
├─ concepts/<id>.yaml       # her kavram bir dosya (trend, sahte kırılım …), iki dil aynı dosyada
├─ svg/<id>.svg             # formasyon ya da kavram çizimi (id ikisi arasında da benzersiz)
├─ sections.yaml            # üst bölümler (Grafik okuma …): sol menünün ve ana sayfanın grupları
├─ categories.yaml          # kategoriler: bölümü, sırası, kapak çizimi (cover), adları ve açıklamaları
└─ planned.yaml             # henüz yazılmamış ama bağlantı verilen formasyonların adları

scripts/build-library.mjs   # YAML + SVG → statik HTML (tr/kutuphane/, en/library/) ve sitemap.xml
```

`id` dosya adıyla aynıdır ve dilden bağımsızdır (İngilizce, kebab-case). Diğer formasyonlara referanslar her zaman `id` ile verilir.

---

## 3. YAML şeması

```yaml
id: head-and-shoulders            # zorunlu, dosya adıyla aynı
kind: chart                       # candle | chart
direction: bearish                # bullish | bearish | neutral
pattern_type: reversal            # reversal | continuation | indecision
candles: multi                    # 1 | 2 | 3 | multi
order: 10                         # kategori içindeki sıra
related: [inverse-head-and-shoulders, double-top, triple-top]
example: null                     # ileride: { pair, tf, from, to, zone }
updated: 2026-10-22

tr:
  slug: omuz-bas-omuz             # URL parçası, dile özel
  name: Omuz Baş Omuz (OBO)
  alt_name: Head and Shoulders    # yalnızca tr: İngilizce adı (okur küresel terimi de öğrensin). en: bloğunda Türkçe ad yazılmaz
  summary: …                      # tek paragraf, sayfa açıklaması ve meta description
  formation:                      # mum: madde listesi | grafik: adımlar
    style: steps                  # bullets | steps
    items:
      - { title: Önceki yükseliş, text: … }     # steps: title + text
      # bullets: düz metin ya da { text, marker: up|down|accent|neutral }
    note: …                       # isteğe bağlı, küçük not
  meaning: [paragraf, paragraf]
  measurement:                    # isteğe bağlı (grafik formasyonları)
    title: …
    text: …
  strengthens: [madde, …]
  weakens: [madde, …]
  zones:
    intro: …                      # isteğe bağlı
    points: [madde, …]            # isteğe bağlı
    paragraphs: [paragraf, …]
  completion: …                   # isteğe bağlı (grafik formasyonları)
  invalidation:                   # düz metin listesi ya da before/after
    before: …
    after: …
  confusions:
    - { id: inverse-head-and-shoulders, text: … }
  facts:                          # sağdaki "Kısa özet" kartı
    - [Tür, Dönüş]
    - [Yön, Düşüş]
  svg_labels:                     # SVG'deki {{key}} yer tutucuları
    left_shoulder: Sol omuz
  svg_alt: …                      # SVG için erişilebilir açıklama
  svg_caption: …

en:
  # tr ile aynı yapı (alt_name hariç)
```

**Metin içi biçim:** sadece `**kalın**` desteklenir. Derleyici bunu `<strong>`'a çevirir, geri kalan her şeyi HTML-escape eder. YAML'a ham HTML yazılmaz.

**Doğrulama (derleme hata vermeli):**
- Zorunlu alanlar eksik: `id`, `kind`, `direction`, `candles`, her iki dilde `slug`, `name`, `summary`, `formation`, `meaning`, `strengthens`, `weakens`, `zones`, `invalidation`, `facts`
- `id` dosya adıyla uyuşmuyor
- Aynı dilde iki formasyon aynı `slug`'ı kullanıyor
- SVG'deki bir `{{key}}` için o dilde `svg_labels` karşılığı yok

**Uyarı (derleme durmaz):** `related` ya da `confusions` içinde henüz yazılmamış bir `id`. Kütüphane kademeli büyüyeceği için bu beklenen bir durum. O kart bağlantısız, düz metin olarak gösterilir, formasyon eklenince kendiliğinden bağlantıya dönüşür. Derleme sonunda bu tür referanslar listelenir.

---

## 3a. Kavram şeması

```yaml
id: false-breakout          # dosya adıyla aynı
kind: levels                # kategori (categories.yaml'daki kind)
order: 40                   # kategori içindeki sıra
related: [trend, pin-bar]   # formasyon ya da kavram id'leri; "İlgili sayfalar" olarak gösterilir
event_keywords: [CPI, TÜFE]  # isteğe bağlı: haftalık olay başlığında geçerse olay bu sayfaya bağlanır
event_countries: [US]       # isteğe bağlı: yalnızca bu ülke kodlu olaylar (US, CRYPTO …)
example: null
updated: 2026-10-23
tr:
  slug: sahte-kirilim
  name: …
  alt_name: …               # yalnızca tr: İngilizce karşılık
  summary: …
  sections:                 # yazıldığı sırayla gösterilir; her bölüm bir tür
    - { type: text, id: definition, title: …, paragraphs: [ … ], note: … }
    - { type: steps, title: …, items: [ { title, text } ] }
    - { type: bullets, title: …, items: [ metin ya da { text, marker } ], note: … }
    - { type: scenarios, title: …, intro: …, items: [ { title, text, tone: up|down|neutral } ] }   # en az 2 kart
    - { type: limits, shows: [ … ], not_proves: [ … ] }   # ZORUNLU: "Neyi gösterir, neyi kanıtlamaz?"
    - { type: zones, intro: …, points: [ … ], paragraphs: [ … ] }   # turuncu "MarketLevelMap bakışı" kutusu
    - { type: box, title: …, text: … }   # kısa not kutusu ("Bu sayfada" listesine girmez)
  confusions: [ { id, text } ]   # isteğe bağlı
  key_points: [ … ]              # sağdaki "Akılda kalsın": 3–5 madde
  svg_labels: { … }
  svg_alt: …
  svg_caption: …
en: { … }                        # aynı yapı, alt_name yok
```

- Her bölümün bir başlığı vardır (`limits` ve `zones` için başlık isteğe bağlı, varsayılan başlık kullanılır).
- Aynı türden iki bölüm varsa birine `id` verilir; `id` sayfa içi bağlantıdır ("Bu sayfada").
- Kavramlar da formasyonlarla aynı ilkelere uyar: al-sat dili yok, olasılık dili, ölçülebilir tanımlar, sahte veriyle elle çizilmiş SVG.

## 4. SVG kuralları

- `viewBox` tanımlı, sabit `width/height` yok. Sayfada `width: 100%` ile ölçeklenir.
- **Sabit renk ve yazı tipi yazılmaz** (derleme hata verir). Renkler sınıflarla verilir; sınıflar sitenin
  token'larına bağlıdır (`assets/library.css`), böylece çizim hem koyu hem açık temada doğru görünür:

| Sınıf | Ne için | Token |
|---|---|---|
| `s-line` | ana fiyat çizgisi (stroke) | metin rengine yakın nötr |
| `s-guide` / `t-guide` | yardımcı çizgi, ölçü oku / yazısı | `--muted` |
| `s-up` `f-up` | yükseliş çizgi / dolgu | `--up` |
| `s-down` `f-down` `t-down` | düşüş çizgi / dolgu / yazı | `--down` |
| `s-accent` `f-accent` `t-accent` | vurgu (boyun çizgisi, kapsama oku) | `--cz` (turuncu) |
| `f-point` | tepe noktaları | `--fg` |
| `t-label` | etiket yazısı | `--muted` |
| `t-mono` | sayısal etiket (JetBrains Mono) | — |

- Yazı tipi sitenin yazı tipidir (Inter; sayısal etiketlerde JetBrains Mono).
- Metinler `{{anahtar}}` yer tutucusuyla yazılır, derleyici dile göre doldurur:
  `<text class="t-label" …>{{left_shoulder}}</text>`
- SVG sayfaya **inline** gömülür (ayrı istek yok). `role="img"` ve `aria-label` derleyici tarafından `svg_alt`'tan eklenir.

---

## 5. URL'ler ve sayfalar

Her dilin kendi adresi vardır (diğer sayfalar tek adreste dil değiştirir; kütüphane arama motorları için iki ayrı sayfa üretir):

| Sayfa | TR | EN |
|---|---|---|
| Kütüphane ana sayfası | `/tr/kutuphane/` | `/en/library/` |
| Kategori | `/tr/kutuphane/mum-formasyonlari/` | `/en/library/candlestick-patterns/` |
| | `/tr/kutuphane/grafik-formasyonlari/` | `/en/library/chart-patterns/` |
| Formasyon | `/tr/kutuphane/<tr.slug>/` | `/en/library/<en.slug>/` |

- Her sayfada `hreflang` ile diğer dildeki karşılığına bağlantı ve `canonical`.
- Dil değiştirici, formasyon sayfasındayken diğer dildeki **aynı formasyona** gider.

### Formasyon sayfası

Mockup'taki sıra:
1. Konum (breadcrumb): Kütüphane / Kategori / Ad
2. Etiketler (tür, yön, mum sayısı), başlık, alternatif ad, özet
3. SVG + açıklama
4. Nasıl oluşur (`formation`)
5. Neye işaret eder (`meaning`, varsa `measurement` kutusu)
6. Güçlendirenler / zayıflatanlar (iki kart)
7. **MarketLevelMap bakışı: Bölgelerle ilişkisi** (turuncu kutu)
8. Varsa tamamlanma (`completion`), geçersiz sayılma (`invalidation`)
9. Sık karıştırılanlar (`confusions` → bağlantılı kartlar)
10. Alt bilgi: "Genel bilgilendirme amaçlıdır. Yatırım tavsiyesi değildir." + `updated`

Sağ sütun: "Bu sayfada" (sadece var olan bölümler), Kısa özet (`facts`), aynı kategorideki diğer formasyonlar (`order`'a göre). Mobilde içeriğin altına iner.

Boş isteğe bağlı alanların bölümü **hiç gösterilmez** ve "Bu sayfada" listesinde de yer almaz.

### Sol menü (bütün kütüphane sayfaları)

- "Genel bakış" (kütüphane ana sayfası), sonra her üst bölümün adı (sections.yaml) ve altında kategori başlıkları
  (kategori sayfasına bağlantı); yanındaki okla açılıp kapanan sayfa listesi. Henüz sayfası olmayan kategori gösterilmez. Bulunulan sayfanın kategorisi açık, diğerleri kapalı başlar. Sıra kategori ve formasyon
  sırasıyla. Bulunulan sayfa vurgulanır. Yeni formasyon ya da kategori eklenince menü kendiliğinden güncellenir.
- Geniş ekranda (≥ 1100 px) solda sabit durur; daha dar ekranda içeriğin üstünde kapalı bir "Konular" kutusudur.

### Kütüphane ana sayfası

- Başlık, alt başlık ve giriş paragrafı.
- Üst bölüm başına (Grafik okuma …) **kategori kartları**: kapak çizimi (`cover`), kategori adı, açıklama, ilk 3
  sayfanın bağlantısı ve "Tümü (sayı) →". Kütüphane büyüdükçe ana sayfa uzamaz; yeni bir kategori
  yeni bir kart, yeni bir bölüm yeni bir kart grubu olarak eklenir.

### Kategori sayfası

- Kategorideki bütün sayfalar (kart: küçük SVG, ad, etiketler, özetin ilk cümlesi). Arama kutusu (ad ve alternatif
  ad içinde); formasyon kategorilerinde ayrıca yön filtresi (Yükseliş / Düşüş / Nötr, yalnızca o kategoride olanlar).
- Filtre ve arama tarayıcıda çalışır, ama kartların hepsi statik HTML olarak sayfada bulunur (SEO).

---

## 6. SEO

- `<title>`: `Yutan Boğa Formasyonu | MarketLevelMap Kütüphane`
- `<meta name="description">`: `summary`
- Open Graph: başlık, açıklama. `og:image` şimdilik sitenin genel görseli. İleride SVG'den PNG üretilebilir.
- JSON-LD: `DefinedTerm` (ad, açıklama, `inDefinedTermSet` = kütüphane) ya da `Article`.
- Sitemap: her formasyon sayfası her iki dilde, `lastmod` = `updated`.

---

## 7. Derleme

Cloudflare Pages'te derleme adımı **yok**. Sayfalar depoda üretilir ve commit'lenir:

```
cd scripts && npm ci        # bir kez: yaml paketi
node build-library.mjs      # tr/kutuphane/, en/library/ ve sitemap.xml'i yeniden yazar
```

- Bir YAML ya da SVG değişince betik çalıştırılır ve üretilen dosyalar aynı commit'e eklenir.
- `.github/workflows/library.yml` her PR'da `node build-library.mjs --check` çalıştırır: doğrulama hatası
  ya da güncel olmayan sayfa varsa kontrol kırmızı olur, bozuk içerik `main`'e girmez.
- Üretilen dosyalar elle düzenlenmez; `tr/kutuphane/` ve `en/library/` klasörleri her derlemede baştan yazılır.
- Sayfaların başlık, menü ve alt bilgi parçaları diğer sayfalarla aynıdır; menüde "Kütüphane" bağlantısı vardır.
- Kütüphane sayfaları `_routes.json` ile Pages Functions'ın dışında tutulur (meta etiketleri HTML'in içinde),
  böylece Functions kotası harcamazlar.

---

## 8. Sonraki sürüm için ayrılan yerler (şimdi yapılmayacak)

- `example`: gerçek grafik örneği (R2 mumları + Lightweight Charts). Alan şimdilik `null`.
- Motorun tespit ettiği formasyonlar: rapor JSON'unda `patterns` katmanı, her biri bir kütüphane `id`'sine bağlanır.
- Analiz notlarında formasyon adlarının kütüphane sayfalarına bağlanması.

---

## 9. İlk içerik listesi

| Kategori | Formasyonlar |
|---|---|
| Mum | Yutan Boğa, Yutan Ayı, Çekiç, Ters Çekiç, Kayan Yıldız, Pin Bar, Doji, Sabah Yıldızı, Akşam Yıldızı |
| Grafik | Omuz Baş Omuz, Ters Omuz Baş Omuz, İkili Tepe, İkili Dip, Yükselen / Alçalan / Simetrik Üçgen, Bayrak, Flama |

İlk listedeki formasyonlar ve sayfalarda adı geçen 11 formasyon (Asılı Adam, Kara Bulut, Delen Mum, Topaç, Boğa ve Ayı Harami, Üçlü Tepe ve Dip, Dikdörtgen, Yükselen ve Alçalan Takoz) yazıldı; toplam 29 formasyon. Yeni bir formasyona bağlantı verilecek ama sayfası henüz yazılmayacaksa adı `planned.yaml` dosyasına eklenir.
