# 🎲 Sanal Masa

**Tarayıcıdan oynanan, kurulumu 2 dakika süren çevrimiçi Dungeons & Dragons masası.**
DM kendi bilgisayarında çalıştırır, oyuncular gelen linke tıklar. Hesap, abonelik, port açma yok.

![DM ekranı: duvarlar ve dinamik görüş](docs/dm-duvar.png)

## Neler var?

| | |
|---|---|
| 🗺️ **Harita** | Sürükle, yakınlaştır, ızgara ayarı, telefonda iki parmakla kullanım |
| 👁️ **Dinamik görüş** | Duvarlar ve kapılar görüşü keser, karanlıkta sadece ışık ve karanlık görüş işe yarar |
| 🌫️ **Savaş sisi** | DM alan alan açar. Görünmeyen düşmanlar oyuncunun tarayıcısına hiç gönderilmez |
| 🔥 **Alan şablonları** | Fireball dairesi, koni, çizgi, kare; içinde kalan hedefleri sayar |
| 📜 **Karakter kağıdı** | Yetenekler, beceriler, saldırılar, büyüler, büyü yuvaları. Tıkla, zar atılsın |
| ⚔️ **Savaş** | İnisiyatif, tur takibi, "Sıra sende!" bildirimi, ölen yaratık duyurusu |
| 🎲 **Zarlar** | Tek tık, avantaj/dezavantaj, `/r 2d6+3`, doğal 20 ve 1 animasyonları |
| 🎙️ **Sesli sohbet** | Discord gerekmez; tarayıcıdan tarayıcıya, kişi başı ses ayarı |
| 🌧️ **Ortam sesi** | Yağmur, fırtına, taverna, mağara… ya da kendi müziğin. Herkeste çalar |
| 🐉 **Hazır yaratıklar** | Goblin'den Kırmızı Ejderha'ya, HP ve AC otomatik |
| 🖼️ **Görsel göster** | DM bir mektubu ya da NPC portresini herkesin ekranında açar |
| ↩️ **Geri al** | Ctrl+Z: taşıma, silme, çizim, hasar… |
| 💾 **Otomatik yedek** | 10 dakikada bir; tek tıkla geri yükleme, masayı dosya olarak taşıma |
| 📊 **Oturum özeti** | Gecenin sonunda kim kaç kritik attı, kaç yaratık öldü |

<p>
  <img src="docs/oyuncu-isik.png" width="49%" alt="Oyuncu karanlıkta meşale ile görüyor">
  <img src="docs/karakter-kagidi.png" width="49%" alt="Karakter kağıdı">
</p>

## Kurulum (sadece DM)

1. **[Node.js](https://nodejs.org)** kur ("LTS" sürümü). Bir kere yapılır.
2. Bu projeyi indir: yeşil **Code → Download ZIP** düğmesi, sonra ZIP'i bir klasöre çıkar.
3. Başlat:

| | Arkadaşlar farklı evlerde | Herkes aynı evde |
|---|---|---|
| **Windows** | `INTERNETE-AC.bat` dosyasına çift tıkla | `BASLAT.bat` dosyasına çift tıkla |
| **Mac / Linux** | Terminalde `bash internete-ac.sh` | `bash baslat.sh` |

Pencerede şuna benzer bir adres çıkar: `https://kelime-kelime-kelime.trycloudflare.com`.
Bu adresi arkadaşlarına gönder. Masadaki **Davet et** düğmesi de aynı adresi kopyalar.

> İnternete açma işi Cloudflare'in **ücretsiz ve hesapsız** hızlı tüneliyle yapılır. Gereken program
> (`cloudflared`) ilk açılışta kendiliğinden indirilir. Adres her açılışta değişir.

**DM şifresi** ilk açılışta rastgele üretilir ve siyah pencerede yazar.
Değiştirmek için `data/ayarlar.json` dosyasındaki `dmSifresi` satırını düzenle.

## Oyuncular için

Gelen linke tıkla, adını yaz, **Masaya otur**. Bir şey kurman gerekmez; telefonda da çalışır.
Sayfa yenilense ya da internet kopsa kendiliğinden geri bağlanır.

## Kısayollar

| Tuş | İşlev |
|---|---|
| `V` `M` `D` `P` `T` | Seç · Ölç · Çiz · İşaret ver · Alan şablonu |
| `F` `W` | (DM) Savaş sisi · Duvar, kapı ve görüş |
| `Shift` + sürükle | Kutu ile çoklu seçim |
| `Ctrl+Z` | Geri al |
| `Ctrl+A` | Tüm tokenlarını seç |
| `Delete` | Seçilenleri sil |
| `Alt` + tık | Haritada bir yeri herkese göster |
| Boşluk + sürükle | Haritayı kaydır |

**Sohbet komutları:** `/r 1d20+5` zar · `/r 2d20kh1` avantaj · `/gr 1d20` gizli zar · `/dm mesaj` DM'e fısılda · `/deneme 20` efekt önizleme

## Sık sorulanlar

**Sesli sohbet bağlanmıyor.** Ses, tarayıcılar arasında doğrudan akar (WebRTC). Bazı okul, iş ya da mobil
ağlarında bu engellenebilir. İleri düzey kullanıcılar `data/ayarlar.json` içindeki `iceServers` listesine bir
TURN sunucusu ekleyebilir. Ayrıca sesli sohbet için `https` adresi (İnternete Aç) ya da `localhost` gerekir.

**"Port kullanımda" hatası.** Masa zaten açık. Tarayıcıda `http://localhost:8080` adresine git.
Başka bir port için: `BASLAT.bat --port=8090`.

**Masayı sıfırlamak istiyorum.** Masayı kapat ve `data/masa.json` dosyasını sil. Yedekler `data/yedekler/` klasöründe.

**Güvenli mi?** Gizli tokenlar, sisteki ve görüş dışındaki düşmanlar, DM notları ve gizli zarlar sunucuda
filtrelenir; oyuncunun tarayıcısına hiç ulaşmaz. DM şifresini kimseyle paylaşma.
Masa sadece sen açık tuttuğun sürece internette durur.

## Geliştiriciler için

Sunucu Node.js + [`ws`](https://github.com/websockets/ws), arayüz derleme adımı olmayan düz JavaScript
modülleri ve tek bir `<canvas>`.

```
server/        Sunucu: index.js (HTTP + WebSocket), actions*.js (komutlar), state.js (durum ve görünürlük)
public/        Arayüz: board.js (harita motoru), voice.js (sesli sohbet), music.js (ortam sesi) …
assets/        Hazır haritalar ve token görselleri
test/          Sunucu ve tarayıcı testleri
```

```bash
node server/index.js --port=8099 --nobrowser --data=test/veri
npm run test:server
npm run test:ui
```

`--data` ile testler ayrı bir klasör kullanır, gerçek masaya dokunmaz. Tarayıcı testi Chrome ya da Edge ister.

---

### English

**Sanal Masa** is a self-hosted, zero-config virtual tabletop for D&D 5e (Turkish UI). The DM runs it with
Node.js; players just open a link. Features: dynamic lighting with walls and doors, fog of war, AoE templates,
character sheets with clickable rolls, initiative tracker, built-in peer-to-peer voice chat, ambient sound,
undo, automatic backups and one-click internet access via Cloudflare quick tunnels (no account needed).
Hidden information (hidden tokens, fogged enemies, DM notes) is filtered server-side.
