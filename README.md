# Marj

Marj, AB'ye satış yapan Türk üreticilerin ihracat teklifini kur, girdi maliyeti ve CBAM belirsizliği altında sınamasına yardım eden, kaynak izli bir karar destek ürünüdür.

Ürün bir "karbon vergisi hesap makinesi" olmaktan çok teklif kararına odaklanır: kullanıcı marjın beklenen değerini, aşağı yönlü riskini, güvenli taban fiyatını ve CBAM yükümlülüğünün hangi resmi verilerle hesaplandığını aynı çalışma alanında görür.

## Mevcut sürüm

- Next.js 16, React 19 ve IBM Carbon ile responsive teklif çalışma alanı
- FastAPI tabanlı, seed ile tekrar üretilebilir Monte Carlo risk motoru
- 371 resmi TCMB iş günü gözleminden üretilen, teslim ufkuna ölçeklenen EUR/TRY modeli
- Kalibrasyon ve bağımsız holdout dönemlerini ayıran kur oynaklığı geriye dönük testi
- Resmi varsayılan değer ve doğrulanmış tesis verisi olmak üzere iki emisyon yöntemi
- Türkiye için 250 resmi varsayılan emisyon kaydı ve 1.804 benchmark satırı
- CN kodunda en uzun önek eşleştirmesi ve üretim rotasına duyarlı Column B benchmark seçimi
- Brüt gömülü emisyon, serbest tahsis düzeltmesi, sertifika adedi ve maliyet için beş adımlı hesap izi
- 2026 Q1 ve Q2 resmi CBAM sertifika fiyatları
- Beklenen marj, P10 marj, zarar olasılığı, maliyet katkıları ve güvenli taban fiyatı
- Kaynak URL'si, yayın tarihi, hukuki dayanak ve SHA-256 kaydı içeren sürümlü veri kataloğu
- API kapalı olduğunda açıkça işaretlenen yerel önizleme durumu
- Ham dosyayı sunucuya göndermeyen CSV, XLSX ve metin PDF içe aktarma akışı
- Ham dosyayı saklamadan yalnızca doğrulanmış senaryo alanlarını cihazda tutan yerel taslak
- Ürün açıklaması veya kod önekiyle resmi katalogdan ilk üç CN adayı
- CSV indirme ve tarayıcı üzerinden PDF/yazdırma raporu

## Hesap yaklaşımı

Resmi varsayılan yöntemde temel hesap şu sırayı izler:

```text
Brüt gömülü emisyon = sevkiyat tonajı × Türkiye varsayılan emisyon yoğunluğu
SEFA = 2026 CBAM faktörü × CSCF × Column B benchmark
Serbest tahsis düzeltmesi = sevkiyat tonajı × SEFA
Sertifika yükümlülüğü = max(0, brüt emisyon - serbest tahsis düzeltmesi)
CBAM taban maliyeti = sertifika yükümlülüğü × resmi dönem fiyatı
```

Monte Carlo katmanı üretim maliyetine kur ve girdi maliyeti şokları, sertifika fiyatına ise karbon fiyatı şoku uygular. EUR/TRY şoku, resmi TCMB alış ve satış kurlarının orta noktasından hesaplanan EWMA oynaklığını teslim ufkuna ölçekler. Geçmiş tahminlerin ilk `%70` bölümü kuyruk kalibrasyonu, son `%30` bölümü bağımsız holdout ölçümü için kullanılır. Düzenleyici CBAM hesabı deterministiktir; belirsizlik bunun üzerinde ayrıca modellenir.

Demo senaryosu, `72163211` CN kodunu Türkiye varsayılanı `7216` ve `(C)` üretim rotalı `72163211` Column B benchmark'ı ile eşleştirir.

## Resmi veri anlık görüntüsü

Katalog sürümü: `2026-08-10`

- Düzeltilmiş kesin dönem varsayılan değerleri: 10 Ağustos 2026
- Kesin dönem benchmark çalışma kitabı: 13 Şubat 2026
- Q1 2026 sertifika fiyatı: `75,36 EUR/tCO2e`
- Q2 2026 sertifika fiyatı: `75,28 EUR/tCO2e`
- 2026 CBAM faktörü: `%97,5`
- 2026 CSCF: `1,0`, 14 Ağustos 2026 tarihli rehberde ön değer
- Basitleştirilmiş eşik sinyali: dört ilgili sektörde AB ithalatçısının yıllık toplamı için 50 ton
- EUR/TRY katalog sürümü: `2026-09-30`, 371 resmi iş günü gözlemi
- Son TCMB EUR/TRY orta kuru: `55,606750`

Q3 2026 fiyatı bu katalog tarihinde yayımlanmadığı için API bu dönem için tahmin üretmez ve yapılandırılmış `422` hatası döndürür.

## Yerel kurulum

Gereksinimler: Node.js 20.9 veya üzeri ve Python 3.11 veya üzeri.

```powershell
cd apps/web
npm install

cd ../../services/api
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

İki servisi birlikte başlatmak için proje kökünde:

```powershell
python scripts/dev.py
```

- Uygulama: http://127.0.0.1:3000
- API belgeleri: http://127.0.0.1:8000/docs
- Sağlık kontrolü: http://127.0.0.1:8000/health

`fixtures/sample-quote.csv` ve `fixtures/sample-quote.xlsx` dosyaları, arayüzdeki **Dosyadan başla** akışını müşteri verisi olmadan denemek için kullanılabilir. Dosya tarayıcıda ayrıştırılır; ham içerik API'ye yüklenmez veya kalıcı depoya yazılmaz. Kullanıcının onayladığı yapılandırılmış senaryo alanları tarayıcının yerel depolamasında sürümlü taslak olarak tutulur; **Örnek değerlere dön** komutu taslağı temizler.

## Docker

Docker kurulu bir ortamda iki servisi üretim imajlarıyla başlatmak için:

```powershell
docker compose up --build
```

Web imajı root olmayan kullanıcıyla çalışan Next.js standalone sunucusudur. API imajı da root olmayan kullanıcıyla çalışır ve `/health` üzerinden container sağlık kontrolü sunar.

Gerçek domainlerle deploy ederken:

- Web imajını `NEXT_PUBLIC_API_URL=https://api.example.com` build argümanıyla oluşturun.
- API containerına `MARJ_ALLOWED_ORIGINS=https://app.example.com` verin.
- Birden fazla izinli origin virgülle ayrılır; joker origin varsayılan olarak kullanılmaz.

`.github/workflows/ci.yml`, her push ve pull request'te API testlerini, Python paket kontrolünü, web lint ve production build'ini, npm güvenlik denetimini ve iki Docker imajının build edilmesini zorunlu tutar.

## Veri kataloğunu yenileme

Pipeline yalnızca izin verilen `taxation-customs.ec.europa.eu` HTTPS alanından, kodda sabitlenmiş resmi çalışma kitabı URL'lerini indirir. İndirme 50 MB ile sınırlıdır; kısmi dosya başarılı aktarım tamamlanmadan kaynak dosyanın yerini alamaz.

```powershell
services\api\.venv\Scripts\python.exe scripts\update_reference_data.py --download
```

Komut, çalışma kitaplarını `.reference-downloads/` altında tutar ve sürümlü `services/api/app/reference_data/catalog.json` dosyasını yeniden üretir. Ham çalışma kitapları Git'e alınmaz; üretilen katalog kaynak hash'lerini taşır.

Önceden indirilmiş dosyalarla yalnızca kataloğu yeniden üretmek için `--download` bayrağını kaldırın.

TCMB kur kataloğunu resmi tarihli XML bültenlerinden yenilemek için:

```powershell
services\api\.venv\Scripts\python.exe scripts\update_fx_data.py
```

Komut varsayılan olarak son 550 takvim gününü tarar; hafta sonu ve bülten yayımlanmayan günleri atlar. Yalnızca `www.tcmb.gov.tr` üzerindeki HTTPS arşivine bağlanır, yanıt boyutunu sınırlar ve her gözlemin kaynak URL'siyle SHA-256 özetini `fx_catalog.json` içinde saklar. Yeniden üretilebilir sabit bir aralık için `--start YYYY-MM-DD --end YYYY-MM-DD` kullanılabilir.

## API

| Yöntem | Uç | Amaç |
| --- | --- | --- |
| `GET` | `/health` | Servis ve katalog sürümü |
| `GET` | `/v1/scenarios/demo` | Kaynak izli demo senaryosu |
| `POST` | `/v1/scenarios/run` | Teklif risk hesabı |
| `GET` | `/v1/market-data/eur-try` | TCMB kur modeli, oynaklık ve holdout metrikleri |
| `GET` | `/v1/reference-data/cn/{cn_code}` | CN, varsayılan değer ve benchmark eşleşmesi |
| `GET` | `/v1/reference-data/search` | Ürün açıklaması veya kod öneki için CN adayları |
| `GET` | `/v1/reference-data/status` | Katalog kapsamı ve kaynak metadatası |

## Doğrulama

```powershell
cd apps/web
npm run lint
npm run build
npm audit --omit=dev

cd ../../services/api
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m pip check
```

Testler resmi varsayılan eşleşmesini, rotaya duyarlı benchmark seçimini, serbest tahsis düzeltmesini, doğrulanmış veri yöntemini, tekrarlanabilir simülasyonu, yayımlanmamış dönem reddini, kur ufku ölçeklemesini ve holdout kalibrasyonunu kapsar.

## Mimari

```text
apps/web                         Next.js ve Carbon kullanıcı arayüzü
services/api/app/cbam.py         Deterministik düzenleyici hesap
services/api/app/engine.py       Monte Carlo teklif risk motoru
services/api/app/fx.py           TCMB kur modeli, kalibrasyon ve backtest
services/api/app/reference.py    Sürümlü katalog ve CN eşleştirme
services/api/app/reference_data  Uygulamaya alınan resmi veri anlık görüntüsü
services/api/tests               Motor ve API sözleşme testleri
scripts/update_reference_data.py Resmi veri indirme ve normalizasyon pipeline'ı
scripts/update_fx_data.py        TCMB EUR/TRY snapshot pipeline'ı
outputs/marj-feasibility.md       Ürün fizibilitesi ve kapsam kararları
```

Web istemcisi başlangıçta demo ve kaynak durumu uçlarını okur. Kullanıcı varsayımları değiştirdiğinde yalnızca yapılandırılmış senaryo girdileri API'ye gönderilir. Dosya yükleme veya müşteri verisi saklama bu sürümde yoktur.

## Sınırlar

Marj resmi beyan, doğrulama raporu, muhasebe kaydı veya hukuki görüş üretmez. Ürün şu anda Türkiye menşeli varsayılan değer paketine ve 2026'da yayımlanmış sertifika dönemlerine odaklanır. AB ithalatçısının yıllık toplam 50 ton eşiği, karbon fiyatının menşe ülkede ödenmesi ve tedarikçi belgelerinin gerçekliği uygulama dışında ayrıca doğrulanmalıdır.

Arayüz ve API sonucu açıkça `decision_support` olarak işaretlenir. Yayımlanmamış resmi değerler uydurulmaz; eksik referans verisi hesaplamayı durdurur.
