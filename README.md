# Mango Monitor v3.5

## v3.5 da nima o'zgardi
1. **Oxirgi seans xarajati.** Nasos yoqilgandan (Yoniq) o'chirilgunga qadar bo'lgan davr — *seans*. Asosiy ekranda "Oxirgi seans" kartasi: boshlanish/tugash vaqti, davomiyligi, kWh, **so'm** va kompressor daqiqasi. Xarajat pog'onali tarif bo'yicha hisoblanadi (seansning har soatdagi ulushi shu soat narxiga ko'paytiriladi).
2. **Statistika → Batafsil:** endi uch ko'rinish: **Soatlar** (har bir soat: kWh, so'm, kompressor daqiqasi, Hz, tashqi harorat — kun/hafta/oy uchun), **Kunlar/Oylar** va **Seanslar** (har bir seans alohida, pastida jami). Jadval ichida aylantiriladi, sarlavha tepada qotib turadi.
3. **Grafiklar har 10 soniyada o'zi yangilanadi** (harorat, quvvat kW, kompressor Hz). Oxirgi qismi 10 soniyalik jonli nuqtalar bilan chiziladi (ilova ochiq turganda xotirada yig'iladi).
4. **Qurilma parametrlari:** 25 kW → kompressor **4100 Vt**. Qolganlari shu nisbatda: 18 kW = 2950, 30 kW = 4920, 35 kW = 5740 Vt. Yangi **"Quvvat (kW)"** maydoni: istalgan kW ni yozing (masalan 22) — kompressor, nasos, ventilyator va oqim shu nisbatda o'zi hisoblanib maydonlarda ko'rinadi. Eski (v3.4) sozlamalar bir marta avtomatik yangilanadi (qo'lda o'zgartirgan qiymatlaringiz saqlanadi).
5. **Issiqlik quvvati (taxmin) har 2 soniyada** yangilanadi (COP, quvvat, tok va ΔT ham). Sahifa qayta chizilmaydi — faqat raqamlar almashadi. Server rejimida jonli so'rov oralig'i 2 s (`LIVE_POLL_SEC`, standart 2) — faqat ilova ochiq paytda.
6. **Boshqaruv:** "Isitish turi" kartasi olib tashlandi, o'rniga **Rejimlar** (Isitish / Sovutish / Avto / Issiq suv ...). Nasosda rejim DP si topilmasa, shu kartadagi ro'yxatdan tanlanadi.
7. **"Isitish mavsumi" kartasi olib tashlandi** (statistikadan).
8. **Gistogrammalar:** ustunga bosilsa shu ustunning o'z ma'lumoti chiqadi (kWh, so'm, kompressor, Hz, tashqi harorat, COP, ishga tushish, defrost). Gistogramma ko'rsatkichini almashtirish mumkin: kWh / so'm / kompressor.
9. **Zoom:** harorat, kVt va Hz grafiklarida ＋ − ◀ ▶ tugmalari va ikki barmoq bilan yaqinlashtirish.
10. **Bildirishnomalar ovozsiz** (ovoz ham, tebranish ham yo'q). Android kanal sozlamasini keyin o'zgartirib bo'lmagani uchun yangi kanal (`mm_alerts_quiet`) yaratiladi, eskisi o'chiriladi.
11. **Pog'onali tarif jadvali** yoqilganda yig'ilgan ("svernut") holda turadi — Sozlama ichida joy egallamaydi; ochish uchun bosiladi.
12. **Bildirishnomalar sozlamasi** (Sozlama ichida, yig'ilgan holda): yuqori paneldagi doimiy bildirishnomani va kelgan ogohlantirishlarni alohida yoqish/o'chirish.

Sinov holati: interfeys, hisob-kitob va mustaqil rejim dvigateli jsdom muhitida soxta Tuya bilan sinab ko'rildi (seanslar, soat/seans jadvali, gistogramma, zoom, kW hisobi, migratsiya, 4 til). **Android (Kotlin) qismi bu muhitda kompilyatsiya qilinmagan** (faqat `Poller.kt` va `MainActivity.kt` da bildirishnoma kanali o'zgargan) va **server testi (`npm test`) ishga tushirilmadi** (`better-sqlite3` bu yerda o'rnatilmadi), serverda faqat sintaksis tekshirildi. Pinch-zoom haqiqiy telefonda sinalmagan. Birinchi GitHub Actions build'da xato chiqsa, logini yuboring.

# Mango Monitor v3.4

## v3.4 da nima o'zgardi
1. **Tashqi harorat vidjet va bildirishnomada:** statusbar bildirishnomasi va vidjet matnida suv haroratidan keyin "Tashqi: -3.0°" ham chiqadi (nasos datchigi `temp_outdoor`, bo'lmasa Open-Meteo). Server rejimida `/api/summary` ga `tamb` qo'shildi.
2. **Standart sozlamalar oldindan yozilgan:** skrinshotdagi barcha DP kodlar va qiymatlar (oqim 71.6, maks. 77°, `temp_top`, `compressor_strength`, `radiator` / `fan coil`, ogohlantirish chegaralari 5/8/30/6/20/3 va h.k.) `DEFAULT_CFG` (`server/src/lib.js`) ichida. APK qayta o'rnatilganda yangi nasos shu qiymatlar bilan keladi; eski nasosga ham bir marta (`_dv` belgisi bilan) qo'llanadi, keyin qo'lda o'zgartirganingiz saqlanadi.
3. **Haftalik jadval:** jadval buyrug'i har bir oraliq uchun **faqat bir marta** beriladi (`doneKey`). Oraliq ichida nasosni qo'lda o'chirsangiz, o'sha kunlik oraliq bekor bo'ladi va qayta yoqilmaydi; keyingi kun oralig'i odatdagidek ishlaydi.
   **Ob-havo avtomatikasi = muzlashdan himoya:** tashqi harorat belgilangan chegaraga (standart 3°) tushsa va nasos o'chiq bo'lsa, nasos avtomatik yoqiladi (ogohlantirish ham keladi). Himoya kerak bo'lgan paytda jadval nasosni o'chirmaydi. Eski "+gradus qo'shish" qoidalari olib tashlandi; izoh matni yangilandi.
4. **Joylashuv:** "Uy sozlamalari" va birinchi sozlashda viloyat/tuman GPS (taxminiy joylashuv ruxsati) orqali aniqlanadi (OpenStreetMap Nominatim). Qo'lda shahar tanlash zaxira sifatida qoldi.
5. **Pog'onali elektr tarifi:** Sozlama → Uy sozlamalarida oylik kWh chegaralari va narxlarni qo'lda o'zgartirish mumkin (standart: 0–200=650, 200–500=900, 500–1000=1100, 1000–5000=1500, 5000–10000=1750, 10000–90000=2000). Har oyning 1-sanasidan hisoblanadi; xarajat, statistika va prognoz shu bo'yicha. **Diqqat:** faqat shu nasosning sarfi pog'onaga qo'shiladi (uyning boshqa sarfi hisobga olinmaydi).
6. **Quvvat hisobi usuli standart "Avto"** (hisoblagich → tok → Hz); modelni tanlaganda Hz ga majburlanmaydi.

Eslatma: bu o'zgarishlarni **Android kodi bu muhitda kompilyatsiya qilinmagan** (`MainActivity.kt` dagi joylashuv, `Sampler.kt`, `Poller.kt`); JS qismi (jadval, muzlashdan himoya, tarif, interfeys) simulyatsiyada sinalgan. Server testi (`npm test`) bu muhitda `better-sqlite3` qurilmagani uchun ishga tushirilmadi, faqat sintaksis tekshirildi.

# Mango Monitor v3.3

## v3.3 da nima o'zgardi
- **Model tanlash (18 / 25 / 30 / 35 kW):** Sozlama → Qurilma sozlamalarida (va birinchi sozlash ekranida) model tanlanadi, quvvat qiymatlari avtomatik qo'yiladi. Ekran ixcham: asosiy maydonlar ko'rinadi, DP kodlar va ogohlantirish chegaralari "Qo'shimcha" bo'limlarida yig'ilgan. Qiymatlar 25 kW nasosdan nisbat bilan olingan taxminiy — o'z nasosingizga qarab aniqlashtiring.
- **Hz bo'yicha hisob:** yangi `ratedHz` (nominal quvvatga mos chastota, masalan 70 Hz = 5000 Vt) va `powerSrc` (Avto / Hz bo'yicha / Tok × kuchlanish). Chastota `ratedHz` dan oshsa sarf ham mos ravishda oshadi (2x gacha cheklov): 90 Hz da 25 kW model kompressori ≈ 6.4 kVt.
- **Rejimlar:** rejim DP si kengroq qidiriladi, Tuya functions ro'yxatida bo'lmasa ham tugmalar chiqadi; Avto jadvalda ham rejim tanlanadi.
- **Radiator / Fancoil:** Boshqaruv ekranida alohida karta. DP avtomatik topilmasa, kartadagi ro'yxatdan nasosning mos DP sini tanlang; qiymatlarni termRad / termFan (Qo'shimcha) da belgilash mumkin.


Issiqlik nasosi (Tuya) monitoringi va boshqaruvi. **Ikki rejim** bor, ilovaning birinchi ekranida tanlanadi:

| | **Mustaqil (serversiz)** | **Server bilan** |
|---|---|---|
| Server/URL kerakmi | **Yo'q** | Ha (`server/`) |
| Tuya kalitlari | Telefonda (shifrlangan xotira) | Faqat serverda |
| Sarf hisobi | Telefon har ~30 s so'raydi (doimiy bildirishnoma xizmati), ilova yopiq bo'lsa ham | Server 24/7 |
| Tashqi harorat | Nasos datchigi, bo'lmasa Open-Meteo (avtomatik) | Xuddi shunday |
| Ko'p foydalanuvchi, Alisa | Yo'q | Ha |

Ikkala rejimda interfeys, statistika, COP, ogohlantirishlar, jadval va ob-havo avtomatikasi bir xil.

## v3.2 da nima o'zgardi
- **Asosiy ekran:** chiqish harorati, bufer bak harorati va kompressor chastotasi (Hz) alohida kataklarda; "hozirgi xarajat" (so'm/soat) va tarif ko'rsatiladi; quvvat manbai (hisoblagich / tok / Hz / taxmin) yozib qo'yiladi.
- **Grafiklar:** barmoq bilan tegilsa shu vaqtdagi qiymatlar chiqadi; quvvat grafigida kompressor ishlagan vaqtlar yashil fon bilan; Hz grafigi; haroratlar grafigida chiqish va bufer chiziqlari.
- **Statistika → Batafsil jadval:** soat (yoki kun) bo'yicha kWh, so'm, kompressor daqiqasi, o'rtacha Hz, tashqi harorat. "Kun" rejimida ‹ › bilan kecha va oldingi kunlarni ko'rish mumkin.
- **Hz bo'yicha hisob:** hisoblagich yo'q bo'lsa quvvat = `compW × (Hz / maxHz)^hzExp`; tok DP kodi berilgan bo'lsa quvvat = tok × kuchlanish × cos φ (kuchlanishga qarab). Sozlama → Qurilma sozlamalarida `hzCode, hzMul, maxHz, hzExp, tbufCode, modeCode` maydonlari bor (bo'sh qoldirilsa DP kod avtomatik qidiriladi).
- **Rejimlar:** Boshqaruv ekranida `mode` (Enum) DP si bo'lsa — tugmalar (Isitish / Sovutish / Avto …); Avto bo'limida har bir vaqt oralig'iga rejim biriktirish mumkin.
- **Xatolar tuzatildi:** (1) server rejimida `m5` jadvaliga tashqi harorat va chiqish harorati almashib yozilardi — grafikdagi "tashqi" chiziq aslida chiqish suvi harorati edi; (2) 7 kunlik tugma "Ya" deb chiqardi (`d7` kaliti yakshanba bilan to'qnashgan); (3) mustaqil rejimda 14 kunlik grafik uchun ma'lumot faqat 7 kun saqlanardi; (4) `compressor_strength = 0` bo'lsa 100% deb hisoblanardi.
- Eski serverda ishga tushganda yangi ustunlar avtomatik qo'shiladi (migratsiya `db.js` da).

## Eng tez yo'l: serversiz APK
1. Repo ildiziga shu arxivdagi hamma narsani yuklang (`.github/`, `android/`, `server/`). GitHub → **Actions** → build tugagach **Artifacts → MangoMonitor** dan APK ni oling.
2. Telefonda eski Mango ilovasini **o'chiring**, yangisini o'rnating.
3. Ilova: til → **Mustaqil (serversiz)** → Tuya Access ID/Secret/Region → uy → Device ID → quvvat qiymatlari → tayyor.
4. Sarf hisobi to'g'ri bo'lishi uchun **doimiy bildirishnoma yoqiq turishi** va (Xiaomi/Huawei/Oppo) batareya cheklovi o'chirilgan bo'lishi kerak (Sozlama'da tugma bor).

## Server rejimi uchun: 1) Serverni ishga tushirish (`server/`)
1. **Tuya Cloud**: iot.tuya.com da loyiha yarating (Data Center — nasosingiz mintaqasi), *IoT Core* va *Authorization* API larini yoqing,
   *Devices → Link Tuya App Account* orqali Smart Life hisobini QR bilan ulang. `Access ID/Secret` ni `.env` ga yozing.
2. `cp .env.example .env` va to'ldiring (`JWT_SECRET` majburiy).
3. `docker compose up -d --build` (yoki `npm ci && npm start`, Node 20+).
4. **HTTPS shart.** Masalan Caddy: `api.sizning-domen.uz { reverse_proxy 127.0.0.1:3000 }`.
5. Tekshirish: `npm test` (Tuya o'rniga mock bilan butun API oqimini sinaydi).

## 2) Ilovani yig'ish (`android/`)
1. `gradle.properties` da `SERVER_URL=https://api.sizning-domen.uz` ni yozing (yoki CI da `vars.SERVER_URL`).
2. Keystore: `keytool -genkeypair -v -keystore mango-release.jks -alias mango -keyalg RSA -keysize 2048 -validity 10000`
   → `keystore.properties.example` ni `keystore.properties` ga nusxalab to'ldiring. **Keystore ni yo'qotmang** — Play Market yangilanishlari uchun kerak.
3. Mahalliy: `gradle assembleRelease bundleRelease`. GitHub Actions: `android/` ni repoga yuklang; secretlar:
   `KEYSTORE_B64` (`base64 -w0 mango-release.jks`), `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`.
4. Play Market uchun: `store-icon-512.png` tayyor; maxfiylik siyosati va "foreground service (data sync)" izohi kerak bo'ladi.

## 3) Mijozni ulash tartibi
Mijoz: ro'yxatdan o'tadi → uy yaratadi → Device ID kiritadi → quvvat qiymatlarini kiritadi.
Qurilma Tuya loyihangizda ko'rinishi kerak (Smart Life hisobi 1-qadamda ulangan bo'lishi shart). Bitta Device ID faqat bitta uyga ulanadi.

## 4) Alisa (Yandex Smart Home)
Yandex Dialogs konsolida "Умный дом" navi yarating: `Endpoint URL` = `https://api.sizning-domen.uz/alice`,
Authorization URL = `.../alice/oauth/authorize`, Token URL = `.../alice/oauth/token`; `client_id/secret` ni `.env` ga yozing.

## Muhim cheklovlar (halol ro'yxat)
- **Mustaqil rejimda** jadval/ob-havo avtomatikasi va ogohlantirishlar ilova ochilganda ishlaydi (hisob-kitob telefon so'ragan namunalardan qilinadi); ilova yopiq paytda faqat namunalar yig'iladi va holat bildirishnomada yangilanadi. To'liq fon avtomatikasi uchun server rejimi kerak.
- **Mustaqil rejimda** telefon o'chsa yoki tizim xizmatni to'xtatsa, o'sha vaqt oralig'i (20 daqiqagacha) oxirgi holat bo'yicha davom etgan deb hisoblanadi.
- **Tuya limitlari.** Har nasos uchun ~1.3 so'rov/poll. `POLL_SEC=60` da oyiga ≈ 57 000 so'rov/nasos. Tuya tarifingiz limitini tekshiring; ko'p mijoz uchun Tuya Pulsar (xabar oqimi) ga o'tish tavsiya etiladi.
- **Mijoz-hisobini ulash qo'lda.** Smart Life hisobini Tuya loyihasiga ulashni (QR) hozircha siz bajarasiz; to'liq o'zi-o'zi ulash Tuya bilan alohida kelishuv talab qilishi mumkin.
- **Push = o'z xizmatimiz.** FCM yo'q: doimiy xizmat (≈45 s) + zaxira sifatida har 15 daqiqada tekshiruv. Ba'zi telefonlarda (Xiaomi, Huawei…) batareya cheklovini o'chirish kerak (Sozlama'da tugma bor). Android 15+ da `dataSync` xizmati 6 soat bilan cheklanadi.
- **Kirill tarjimasi avtomatik** (lotindan translitratsiya). Chop etishdan oldin ona tili egasiga ko'rsating. Rus/ingliz qo'lda yozilgan.
- **COP va issiqlik quvvati** nasosda oqim datchigi bo'lmasa, nominal oqimga (`flowLpm`) tayanadi — taxminiy. Tok/kuchlanish/cos φ ham DP kodi berilmasa hisoblab chiqariladi (ilovada "taxminiy" deb belgilanadi).
- Alisa integratsiyasi Yandex tomonida moderatsiyadan o'tishi kerak.
- Rasmiy test: server API (mock Tuya) va interfeys (brauzer muhitida) sinalgan. **Android kod bu muhitda kompilyatsiya qilinmagan** — birinchi CI ishga tushganda chiqqan xatolarni yuboring.
