# Digital Twin Pendakian Gunung Gede Pangrango Jalur Putri

Kembaran digital jalur pendakian Gunung Gede Pangrango via Jalur Putri. Setiap pendaki mendaftar lewat formulir yang sekaligus menghasilkan QR Code, lalu memindai QR itu di tiap pos. Data scan langsung tampil sebagai model 3D jalur. Sistem juga membaca curah hujan di sembilan pos, lalu menghitung pos mana yang aman dibuka, harus ditahan, atau ditutup, serta pendaki mana yang perlu perhatian petugas.

Tujuannya: petugas melihat kondisi gunung seperti berdiri di semua pos sekaligus, lalu mengambil keputusan lebih cepat dan lebih tepat.

**Demo langsung:** https://yogyremasetyantoui.github.io/monitoring-pendakian/dashboard_monitoring_3D.html

**Formulir pendaftaran + QR Code:** https://yogyremasetyantoui.github.io/monitoring-pendakian/form-pendaftaran-pendakian.html

## Daftar Isi

- [Posisi Digital Twin](#posisi-digital-twin)
- [Fitur Utama](#fitur-utama)
- [Infrastruktur yang Dibutuhkan](#infrastruktur-yang-dibutuhkan)
- [SOP Petugas Berdasarkan Kondisi Sistem](#sop-petugas-berdasarkan-kondisi-sistem)
- [Simulasi Demo per Skenario](#simulasi-demo-per-skenario)
- [Berkas dan Konfigurasi](#berkas-dan-konfigurasi)
- [Batasan](#batasan)

## Posisi Digital Twin

Digital twin ini dibangun dari tiga lapisan.

**1. Dunia nyata (fisik).** Pendaki yang naik dan turun, sembilan pos (Basecamp, Tanah Merah, Pos 1 Gerbang, Legok Leunca, Buntut Lutung, Lawang Sekateng, Simpang Maleber, Surya Kencana, Puncak), serta hujan, kabut, dan kondisi jalur.

**2. Sensor dan sumber data.** Sensornya adalah scan QR Code di setiap pos. QR dibuat dari formulir pendaftaran sendiri. Selain itu ada laporan SOS dan data cuaca per titik pos. Data booking resmi dapat menjadi sumber tambahan bila diizinkan pengelola.

**3. Model digital (twin).** Medan 3D asli (elevasi AWS Terrain Tiles, citra Esri, jalur GPX) menjadi dasar peta. Di atasnya ada mesin aturan yang menghitung kepadatan, keterlambatan, cuaca per segmen, dan status buka/tahan/tutup pos. Aturan yang sama dipakai di tampilan 2D dan 3D, sehingga keduanya selalu memberi keputusan yang sama.

Alurnya melingkar:

```
Kondisi lapangan ──scan QR / SOS / cuaca──▶ Model digital ──rekomendasi──▶ Petugas
        ▲                                                                      │
        └──────────────────── tindakan di lapangan ◀───────────────────────────┘
```

Kondisi di lapangan masuk ke model, model menghasilkan keputusan (misalnya pos ditutup atau pendaki perlu dicari), lalu petugas menjalankannya di lapangan. Tindakan petugas mengubah kondisi nyata, dan perubahan itu terbaca lagi lewat scan berikutnya.

## Fitur Utama

### 1. Pendaftaran terintegrasi QR Code

Sistem punya [formulir pendaftaran sendiri](https://yogyremasetyantoui.github.io/monitoring-pendakian/form-pendaftaran-pendakian.html) yang selain mencatat pendaki juga menghasilkan QR Code untuk scan di pos.

1. Pendaki atau ketua rombongan mengisi formulir.
2. Formulir menghasilkan QR Code sebagai identitas selama pendakian.
3. QR dipindai di tiap pos, dari Basecamp sampai Puncak dan kembali turun.
4. Setiap scan memperbarui posisi, status, dan estimasi tiba di pos berikutnya pada dashboard 3D.

Karena data pendaki sudah ada sejak sebelum naik, petugas bisa mengenali siapa yang masuk jalur, siapa yang belum turun, dan siapa yang tidak sampai pos.

Sistem juga dirancang agar bisa dihubungkan dengan [data kuota dan booking resmi](https://booking.gedepangrango.org/kuota), supaya pendaftar di booking bisa dicocokkan dengan yang benar-benar masuk jalur. Integrasi ini **hanya dijalankan bila diizinkan pengelola**. Selama belum ada izin, formulir sendiri menjadi sumber data pendaki.

### 2. Informasi pendakian real-time

Posisi pendaki naik dan turun tampil di peta 3D dan diperbarui otomatis tiap 30 detik. Setiap pos menampilkan jumlah pendaki terhadap kapasitas (misalnya 0/30), dan jalur memperlihatkan segmen yang padat lewat gradasi warna. Pendaki bisa diklik untuk melihat detail dan dicari lewat pencarian.

### 3. Laporan SOS dan pendaki tidak sampai pos

Pendaki yang memicu SOS muncul sebagai penanda darurat di peta dan masuk daftar "Perlu Perhatian", lengkap dengan segmen, koordinat, dan ketinggian. Pendaki yang terlambat sampai pos berikutnya ditandai bertingkat: lebih dari 1 jam, 2 jam, dan 3 jam. Kondisi ini menjadi pemicu SOP darurat petugas (lihat [SOP Petugas](#sop-petugas-berdasarkan-kondisi-sistem)).

### 4. Curah hujan menentukan buka-tutup pos

Cuaca diperbarui tiap 10 menit untuk sembilan pos.

- Pos dengan **hujan lebat atau lebih** (di atas 10 mm/jam) **ditutup**.
- **Pos tepat di bawah dan di atasnya ikut ditutup.**
- Pendakian ditahan di pos sebelum zona hujan dimulai.
- Pendaki yang sedang berjalan menuju pos tertutup ditandai sebagai pelanggar agar petugas bisa menghentikannya.

Hujan sedang memunculkan status waspada tetapi belum menutup pos. Garis hujan animasi di jalur menunjukkan cuaca segmen, diambil dari yang terburuk di antara dua pos di ujungnya.

| Kelas | Curah hujan | Dampak |
|---|---|---|
| Tidak hujan | < 0,1 mm/jam | Normal |
| Hujan ringan | 0,1 – 5 mm/jam | Normal |
| Hujan sedang | 5,1 – 10 mm/jam | Status waspada, membentuk zona hujan |
| Hujan lebat | 10,1 – 20 mm/jam | Pos ditutup beserta pos di atas dan di bawahnya |
| Badai / ekstrem | > 20 mm/jam | Sama dengan hujan lebat |

### 5. Buka-tutup jalur saat penuh

Tiap pos punya batas kapasitas: 30 orang untuk pos jalur, 150 untuk Puncak, dan tanpa batas untuk Basecamp serta Surya Kencana. Pada 80% kapasitas status berubah menjadi hampir penuh. Saat penuh, pendakian ditahan di pos sebelumnya dan pendaki yang menuju pos penuh ditandai.

### 6. Fitur pendukung

- Tampilan **2D (tabel)** dan **3D (peta)** yang bisa dialihkan dengan satu tombol.
- **Prakiraan cuaca per jam** untuk tiap pos.
- Label pos melayang dengan garis putus-putus ke titik pos, sehingga pendaki di jalur tetap bisa diklik.
- **Cincin merah** di pos yang ditahan atau ditutup, plus banner peringatan di bagian atas.
- **Mode malam**, mode hemat grafis untuk perangkat lemah, kamera fokus per pos, dan putar otomatis.
- **Penanganan gangguan:** bila data live gagal dimuat, dashboard memberi peringatan dan tetap menampilkan data terakhir. Data palsu tidak pernah ditampilkan di mode live. Bila data cuaca tidak tersedia, penutupan otomatis tidak aktif, sehingga petugas perlu mengecek manual.

## Infrastruktur yang Dibutuhkan

Digital twin hanya sebaik data yang masuk. Karena sumber utamanya adalah scan di pos, kebutuhan utamanya adalah **scanner QR Code yang terhubung ke internet di setiap pos**.

**Perangkat di tiap pos**

- Satu unit scanner QR Code (ponsel atau tablet petugas dengan kamera, atau perangkat scanner khusus) yang terhubung ke internet.
- Koneksi internet di pos, dengan dua pilihan:
  - **Tarik kabel internet** ke pos, cocok untuk pos yang dekat dengan jaringan yang sudah ada seperti Basecamp.
  - **Pasang Starlink** untuk pos yang jauh dan tidak terjangkau kabel maupun sinyal seluler.

Pilihan konektivitas per pos perlu ditentukan setelah survei lapangan, karena kondisi tiap pos berbeda. Sebagai gambaran, pos dekat basecamp mungkin cukup dengan kabel, sedangkan pos di punggungan dan Surya Kencana lebih cocok memakai Starlink.

**Hal yang sebaiknya dipertimbangkan saat survei** (usulan, belum menjadi bagian sistem saat ini)

- **Catu daya.** Starlink dan scanner butuh listrik di tempat tanpa jaringan PLN. Panel surya dengan baterai adalah opsi yang lazim.
- **Perlindungan cuaca.** Perangkat perlu pelindung dari hujan dan kelembapan tinggi.
- **Cadangan bila koneksi putus.** Dashboard tampil dari data yang masuk ke server, jadi pos yang offline akan tampak "sepi". Pencatatan manual sementara dan input susulan perlu disiapkan, atau fitur penyimpanan offline di scanner dapat dikembangkan.

**Di sisi pusat**, dashboard dibuka lewat peramban di pos pantau atau ruang kendali petugas. Tidak perlu server khusus di pos, karena data dan dashboard berjalan di layanan web.

## SOP Petugas Berdasarkan Kondisi Sistem

Dashboard memberi tanda, dan petugas yang bertindak. Tabel di bawah adalah **usulan** SOP yang menghubungkan tiap kondisi di sistem dengan tindakan petugas. Isi akhirnya perlu ditetapkan bersama pengelola dan tim SAR sesuai kewenangan masing-masing.

| Kondisi di sistem | Arti | Usulan tindakan petugas |
|---|---|---|
| **HAMPIR PENUH** | Pos mencapai 80% kapasitas, atau pendaki yang menuju ke sana bisa melebihi batas | Beri tahu petugas pos berikutnya, siapkan pengaturan arus, pantau terus. |
| **TAHAN NAIK / PENUH** | Pos penuh atau ada zona hujan di atas; pendakian ditahan di pos sebelumnya | Petugas di pos penahan meminta pendaki berhenti dan menunggu, lalu menginformasikan alasannya. Lepas hanya setelah status kembali BUKA. |
| **WASPADA HUJAN** | Hujan sedang di sebuah pos | Informasikan ke pendaki di pos terkait, ingatkan perlengkapan jas hujan dan kewaspadaan, pantau perubahan cuaca. |
| **DITUTUP (hujan lebat)** | Pos hujan lebat, beserta pos di atas dan di bawahnya | Hentikan pendaki yang akan masuk pos tutup, arahkan pendaki yang sudah di dalamnya ke tempat aman sesuai keputusan petugas, dan umumkan penutupan. |
| **Pelanggar** | Pendaki sedang berjalan menuju pos penuh atau tertutup | Hubungi petugas terdekat di jalur untuk menghentikan atau mengarahkan pendaki itu. |
| **Terlambat 1 jam** | Pendaki melewati perkiraan waktu tiba | Pantau, coba hubungi rombongan, cek apakah ada informasi dari pendaki lain atau pos. |
| **Terlambat 2 jam** | Keterlambatan berlanjut | Tingkatkan kewaspadaan, kabari petugas pos terdekat untuk mengecek segmen jalur itu. |
| **Terlambat 3 jam** | Keterlambatan panjang | Anggap sebagai potensi darurat: aktifkan SOP pencarian, informasikan ke koordinator dan tim SAR. |
| **SOS** | Pendaki memicu laporan darurat | Aktifkan SOP darurat segera. Gunakan segmen, koordinat, dan ketinggian dari dashboard untuk mengarahkan tim ke lokasi, dan kabari koordinator serta tim SAR. |
| **Cuaca tidak tersedia** | Data hujan gagal dimuat | Cek cuaca secara manual dan jangan menganggap "tidak ada penutupan" sebagai kondisi aman. |

Catatan untuk petugas:

- Sistem **tidak mengirim notifikasi otomatis**. Petugas perlu memantau dashboard, atau notifikasi (misalnya ke WhatsApp atau Telegram) dapat ditambahkan sebagai pengembangan.
- Posisi pendaki di antara pos adalah **perkiraan**, sehingga pencarian perlu mencakup seluruh segmen terkait.
- Penutupan hanya menandai pos dan pendaki yang menuju ke sana. Sistem **tidak memaksa** pendaki yang sudah di dalam pos untuk turun. Itu keputusan petugas.
- Data cuaca per titik bisa berubah sesaat. Sebelum mengumumkan penutupan, petugas sebaiknya mengonfirmasi kondisi di lapangan.

## Simulasi Demo per Skenario

Tambahkan kode skenario di belakang alamat dashboard, misalnya:

```
https://yogyremasetyantoui.github.io/monitoring-pendakian/dashboard_monitoring_3D.html?demo4
```

| URL | Skenario | Yang terlihat |
|---|---|---|
| `?demo1` | Normal | Pendakian lancar, cuaca cerah, semua pos BUKA. Sebagai kondisi acuan. |
| `?demo2` | Ramai | Pos dan jalur padat, beberapa pos hampir penuh, hujan sedang (waspada), beberapa pendaki terlambat. |
| `?demo3` | Pos penuh | Legok Leunca penuh, pendakian ditahan di Pos 1 Gerbang, pendaki yang menuju pos penuh ditandai pelanggar. |
| `?demo4` | Hujan lebat | Hujan lebat di Buntut Lutung dan Lawang Sekateng. Pos Legok Leunca sampai Simpang Maleber ditutup, pendaki yang menuju ke sana ditandai. |
| `?demo5` | SOS | Tiga pendaki memicu SOS (dua di jalur, satu di pos), muncul di daftar perhatian dengan koordinat. |
| `?demo6` | Krisis gabungan | Hujan lebat dan badai di bagian atas jalur, pos atas ditutup, Legok Leunca penuh, pendaki terlambat lama, dan dua SOS bersamaan. Menguji semua aturan sekaligus. |

Data tiap skenario selalu sama, sehingga cocok untuk presentasi dan pelatihan petugas, misalnya mencocokkan setiap skenario dengan tabel SOP di atas. `?demo` tanpa angka memberi data acak. Parameter `?demo=N` juga dikenali, dan nomor di luar 1–6 jatuh ke data acak.

Opsi grafis: tambahkan `?lite` (hemat) atau `?full` (kualitas penuh), misalnya `?demo2&lite` untuk skenario terpadat di perangkat lemah.

## Berkas dan Konfigurasi

| Berkas | Fungsi |
|---|---|
| `dashboard_monitoring_3D.html` | Dashboard peta 3D: medan, pos, pendaki, label melayang, panel status. |
| `monitoring_core.js` | Logika bersama dashboard 2D dan 3D: konfigurasi pos, klasifikasi hujan, kapasitas, aturan tahan dan tutup pos, serta data skenario demo. |

Dua berkas ini harus diunggah bersamaan. Tampilan 2D memakai `monitoring_core.js` yang sama, sehingga aturannya selalu sama.

Pengaturan utama ada di `monitoring_core.js`:

| Konstanta | Nilai saat ini | Arti |
|---|---|---|
| `WEATHER_REFRESH_MS` | 10 menit | Interval pembaruan cuaca |
| `WEATHER_STALE_MS` | 25 menit | Data cuaca lebih tua dari ini dianggap basi |
| `WEATHER_TRIGGER_LEVEL` | 3 (hujan lebat) | Level hujan yang memicu penutupan pos |
| `WEATHER_ZONE_MIN_LEVEL` | 2 (hujan sedang) | Level minimum untuk membentuk zona hujan |
| `NEAR_FULL_RATIO` | 0,8 | Batas status hampir penuh |
| `POS[].cap` | 30 / 150 / tanpa batas | Kapasitas tiap pos |

Di `dashboard_monitoring_3D.html`, konstanta `LABEL_LIFT` (saat ini 20) mengatur tinggi label pos melayang di atas titik pos.

## Batasan

- Posisi pendaki **di antara pos** adalah estimasi dari waktu scan terakhir dan perkiraan waktu tiba di pos berikutnya, bukan pelacakan GPS langsung. Posisi pasti baru diketahui saat scan di pos.
- Keputusan buka/tutup adalah **rekomendasi sistem**. Eksekusi dan pengumumannya dilakukan petugas, sehingga manusia tetap menjadi pengambil keputusan akhir.
- Integrasi dengan sistem booking resmi masih berupa rencana dan hanya dijalankan bila diizinkan pengelola.
- Tabel SOP adalah usulan dan perlu ditetapkan bersama pengelola dan tim SAR.
- Bila data cuaca tidak tersedia, penutupan otomatis tidak aktif.

## Sumber Data dan Atribusi

- Elevasi medan: AWS Terrain Tiles
- Citra: Esri World Imagery
- Jalur: GPX Wikiloc
