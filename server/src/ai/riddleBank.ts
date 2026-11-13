export interface RawRiddleEntry {
  kind: "RIDDLE" | "RUNE" | "CLOCK";
  q: string;
  opts: string[];
  ans: number;
}

/**
 * 225 Özgün Türkçe Bilmece, Gotik Şato Mantık Sorusu, Kadim Rün Dizilimi & Saat/Kasa Şifresi Havuzu
 * - Her oyunda karıştırılmış deste (anti-repeat) ve rastgele şık sırası ile sunulur.
 */
export const MASTER_RIDDLE_BANK: RawRiddleEntry[] = [
  // =========================================================================
  // BÖLÜM 1: KLASİK TÜRKÇE BİLMECELER & ŞATO MANTIĞI (RIDDLE — 80 ADET)
  // =========================================================================
  {
    kind: "RIDDLE",
    q: "Çarşıdan aldım bir tane, eve geldim bin tane. Bu nedir?",
    opts: ["🍎 Nar", "🍇 Üzüm", "🌰 Ceviz", "🍋 Limon"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Ben giderim o gider, arkamdan tık tık eder; güneşte doğar, karanlıkta kaybolur. Nedir?",
    opts: ["👤 Gölge", "🕯️ Mum", "💨 Rüzgâr", "🦉 Baykuş"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Adını söylediğin anda bozulan ve kırılan tek şey nedir?",
    opts: ["🤫 Sessizlik", "🪞 Ayna", "🧊 Buz", "📜 Mühür"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Her tarafı deliklerle doludur ama yine de suyu içinde tutar. Bu nedir?",
    opts: ["🧽 Sünger", "🪣 Kova", "🕸️ Örümcek Ağı", "🧣 Pelerin"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Sürekli yukarı çıkar ama asla aşağı inmez. Bu nedir?",
    opts: ["⏳ Yaş", "🔥 Duman", "🦅 Kuzgun", "🌧️ Yağmur"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Ateşte yanmaz, suda batmaz, toprağa girmez. Nedir bu?",
    opts: ["☀️ Güneş Işığı", "🪵 Kuru Odun", "📜 Parşömen", "⛓️ Demir"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Ağzı vardır konuşmaz, yatağı vardır uyumaz, koşar ama ayağı yoktur. Nedir?",
    opts: ["🌊 Irmak", "🕰️ Saat", "🚪 Kapı", "🎻 Kemancı"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Gençken uzundur, yaşlandıkça kısalır ve ağladıkça etrafı aydınlatır. Nedir?",
    opts: ["🕯️ Mum", "🌲 Çam Ağacı", "🗡️ Hançer", "🪶 Tüy Kalem"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Dişleri çoktur ama hiçbir şeyi ısıramaz. Şato odalarında hanımların masasındadır. Nedir?",
    opts: ["🪮 Tarak", "🗝️ Anahtar", "🪚 Testere", "🍴 Çatal"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Bana bakarsan ben de sana bakarım; gülersen gülerim ama hiç ses çıkarmam. Neyim ben?",
    opts: ["🪞 Ayna", "🖼️ Tablo", "🗿 Heykel", "🕯️ Şamdan"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "İçinden aldıkça büyüyen, içine koydukça küçülen şey nedir?",
    opts: ["🕳️ Çukur", "💰 Altın Kesesi", "🏺 Küp", "📦 Sandık"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Boynu var başı yok, iki kolu var ama hiç eli yok. Nedir?",
    opts: ["👕 Gömlek / Ceket", "🪑 Sandalye", "🏺 Sürahi", "🛡️ Kalkan"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Karanlık bir şato mahzeninde elinde tek bir kibrit var. İçeride şömine, gaz lambası ve mum var. Önce hangisini yakarsın?",
    opts: ["🔥 Kibriti", "🕯️ Mumu", "🏮 Gaz Lambasını", "🪵 Şömineyi"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Ne kadar çok koşarsan o kadar arkanda bıraktığın şey nedir?",
    opts: ["👣 Ayak İzleri", "💨 Nefes", "👤 Gölgen", "🌙 Gece"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Dünyayı dolaşır ama hep mektubun bir köşesinde oturur. Bu nedir?",
    opts: ["✉️ Pul / Mühür", "🧭 Pusula", "🗺️ Harita", "🪶 Kuzgun"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Kırılmadan kullanılamayan mutfak nimeti hangisidir?",
    opts: ["🥚 Yumurta", "🍞 Ekmek", "🧀 Peynir", "🍯 Bal"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Gözü var ama hiçbir şey göremez, ucunda ip taşır. Nedir?",
    opts: ["🪡 İğne", "🗝️ Anahtar", "💍 Yüzük", "🗡️ Kılıç"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Dili vardır konuşamaz, sayfaları vardır yürüyemez ama tüm sırları anlatır. Nedir?",
    opts: ["📖 Kitap", "🔔 Çan", "👞 Çizme", "🎻 Lavta"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Suya düşer ıslanmaz, toprağa düşer paslanmaz. Nedir?",
    opts: ["☀️ Güneş / Gölge", "🪙 Altın", "🪨 Çakıl Taşı", "🍂 Yaprak"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Gece doğar, gündüz ölür; gökyüzünde gümüş bir orak gibi parlar. Nedir?",
    opts: ["🌙 Hilal (Ay)", "☀️ Güneş", "🌩️ Şimşek", "🌈 Gökkuşağı"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Dört ayağı var ama tek adım bile atamaz; davetliler hep etrafında toplanır. Nedir?",
    opts: ["🪑 Masa / Sandalye", "🐎 At", "🐕 Av Köpeği", "🐺 Kurt"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Elleri vardır alkışlayamaz, yüzü vardır gülemez ama zamanı hiç şaşırmaz. Nedir?",
    opts: ["🕰️ Saat", "🗿 Zırh Heykeli", "🎭 Maske", "🖼️ Portre"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Bir kova suyun içine atıldığında suyu yükseltmek yerine hafifleten tek şey nedir?",
    opts: ["🕳️ Kovanın Deliği", "🧊 Buz Kalıbı", "🪶 Tüy", "🧽 Sünger"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Yemez içmez ama odanın her köşesini bir anda doldurur. Karanlığı kovar. Nedir?",
    opts: ["🕯️ Işık", "🪵 Kömür", "🕸️ Toz", "🪨 Mermer"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Sana aittir ama başkaları onu senden çok daha sık kullanır. Nedir?",
    opts: ["🏷️ Adın (İsmin)", "🗝️ Oda Anahtarın", "🧥 Pelerinin", "🪙 Altının"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Ağlar ama gözü yoktur, yürür ama ayağı yoktur, gökyüzünde gezer. Nedir?",
    opts: ["🌧️ Bulut", "🦅 Kartal", "🌙 Ay", "⭐ Yıldız"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Kapağı var tencere değil, yaprağı var ağaç değil. Kütüphanede seni bekler. Nedir?",
    opts: ["📚 Kitap", "🗺️ Pusula", "🕯️ Fener", "⚱️ Vazo"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Küçücük fıçıcık, içi dolu turşucuk. Bu klasik bilmecenin cevabı nedir?",
    opts: ["🍋 Limon", "🍏 Elma", "🌰 Fındık", "🫒 Zeytin"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Dal üstünde kilitli sandık. Bu bilmecenin cevabı nedir?",
    opts: ["🌰 Ceviz", "🍒 Kiraz", "🍇 Üzüm", "🍐 Armut"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Kat kat açılır ama dikişi yok; doğrarken insanı ağlatır ama suçu yok. Nedir?",
    opts: ["🧅 Soğan", "🥬 Lahana", "🍋 Limon", "🧄 Sarımsak"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Yer altında sakallı dede. Mutfak kilerinde bulunan bu sebze nedir?",
    opts: ["🥬 Pırasa / Turp", "🍅 Domates", "🥒 Salatalık", "🌶️ Biber"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Sarıdır safran gibi, okunur Kur'an gibi; ya bunu bilirsin ya bu gece ölürsün! Nedir?",
    opts: ["🪙 Altın", "🕯️ Balmumu", "🌾 Buğday", "🧀 Peynir"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Uzaktan baktım bir taş, yanına vardım dört ayak bir baş. Nedir?",
    opts: ["🐢 Kaplumbağa", "🦔 Kirpi", "🐇 Tavşan", "🦀 Yengeç"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Kanadı var kuş değil, boynuzu var koç değil. Bahçede uçar. Nedir?",
    opts: ["🦋 Kelebek", "🐝 Arı", "🦇 Yarasa", "🐞 Uğur Böceği"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Gündüz tavanda baş aşağı uyur, gece karanlıkta sesle yolunu bulur. Hangi şato canlısıdır?",
    opts: ["🦇 Yarasa", "🦉 Baykuş", "🐦‍⬛ Kuzgun", "🕷️ Örümcek"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Şömineye atılan zarf KAN KIRMIZISI alevle yanarsa elenen oyuncunun gerçek rolü nedir?",
    opts: ["🗡️ Hain", "🕯️ Masum Misafir", "👑 Şato Kâhyası", "👻 Gezgin Hayalet"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Şömineye atılan zarf BEYAZ alevle parlayıp sönerse elenen davetli kimdir?",
    opts: ["🕯️ Masum Misafir", "🗡️ Hain", "👑 Kâhya", "🐺 Kurtadam"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Üç davetli konuşuyor: Sinan 'Lale Haindir', Lale 'Kemal Haindir', Kemal 'İkisi de yalan söylüyor!' diyor. Tek 1 Hain varsa ve sadece Hain yalan söylüyorsa Hain kimdir?",
    opts: ["Lale", "Sinan", "Kemal", "Hiçbiri"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "İki muhafızdan biri hep doğru, diğeri hep yalan söylüyor. Hangisinin doğrucu olduğunu tek soruyla bulmak için ne sorarsın?",
    opts: ["'Diğer muhafız hangi kapıyı gösterirdi?'", "'Saat kaç?'", "'Sen yalancı mısın?'", "'Şato kimin?'"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Gündüz yarışında gizli Altın Kolye'yi kazanan oyuncuya o gece ne olur?",
    opts: ["🛡️ Gece Hain saldırısından korunur", "🗳️ Oyu üç sayılır", "🗝️ Tüm kapıları kırar", "👑 Oyunu anında kazanır"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Yuvarlak Sofra'da kimsenin oturamadığı ve daima Kâhya'ya ayrılan makam hangi sandalyedir?",
    opts: ["🪑 Sandalye #11", "🪑 Sandalye #1", "🪑 Sandalye #6", "🪑 Sandalye #12"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Bir yarışta ikinci sıradaki koşucuyu geçersen kaçıncı sırada olursun?",
    opts: ["🥈 İkinci", "🥇 Birinci", "🥉 Üçüncü", "🏅 Sonuncu"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Bir yarışta sonuncu sıradaki kişiyi geçersen kaçıncı olursun?",
    opts: ["❌ Sonuncuyu geçmek imkânsızdır", "🥇 Birinci", "🥈 Sondan ikinci", "🥉 Üçüncü"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Meryem'in babasının 5 kızı vardır: Nana, Nene, Nini, Nono. Beşinci kızın adı nedir?",
    opts: ["Meryem", "Nunu", "Nalan", "Nil"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Bazı aylarda 30, bazılarında 31 gün vardır. Kaç ayda 28 gün vardır?",
    opts: ["📅 12 ayın hepsinde", "📅 Sadece 1 ayda", "📅 2 ayda", "📅 6 ayda"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Bir doktor sana 3 hap verip 'Yarımşar saat arayla iç' derse hapların bitmesi kaç dakika sürer?",
    opts: ["⏱️ 60 Dakika", "⏱️ 90 Dakika", "⏱️ 120 Dakika", "⏱️ 30 Dakika"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Bir horoz şatonun tam sivri çatısına yumurtlarsa yumurta hangi tarafa düşer?",
    opts: ["🐓 Horoz yumurtlamaz!", "⬅️ Batı yamacına", "➡️ Doğu yamacına", "⬇️ Bacanın içine"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "1 kilo demir mi daha ağırdır, yoksa 1 kilo kuş tüyü mü?",
    opts: ["⚖️ İkisi de eşittir (1 kilo)", "⛓️ Demir daha ağırdır", "🪶 Kuş tüyü daha ağırdır", "💨 Rüzgâra göre değişir"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Hiç ıslanmadan denizin dibinde yürüyen şey nedir?",
    opts: ["👤 Bulutun / Geminin Gölgesi", "🐟 Balık", "⚓ Çapa", "🦀 Yengeç"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Konuşmadan her dili aynen tekrar edebilen gizemli ses nedir?",
    opts: ["🏔️ Yankı", "💨 Fırtına", "🔔 Çan", "🦉 Baykuş"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "İlkbaharda yeşil pelerinini giyer, sonbaharda yapraklarını tek tek döker. Nedir?",
    opts: ["🌳 Ağaç", "🐻 Ayı", "🏔️ Dağ Zirvesi", "🏰 Kule"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Ne kanı var ne canı, beş tanedir parmağı. Şövalyenin elini korur. Nedir?",
    opts: ["🧤 Eldiven", "🛡️ Kalkan", "👢 Çizme", "🪖 Miğfer"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Başında tacı var kral değil, sabahları herkesi uyandırır bekçi değil. Nedir?",
    opts: ["🐓 Horoz", "🦅 Kuzgun", "🔔 Kilise Çanı", "🎺 Borazan"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Elden ele dolaşır ama kimse onu tutmak istemez; bir şöminede başlar. Nedir?",
    opts: ["🔥 Kor Ateş", "🪙 Altın Sikke", "📜 Davetiye", "💍 Yüzük"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Üzerinde şehirler var ama ev yok, ormanlar var ama ağaç yok, denizler var ama tek damla su yok. Nedir?",
    opts: ["🗺️ Harita", "🪞 Ayna", "⏳ Kum Saati", "📜 Takvim"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Tek bir kibrit çöpüyle odayı hiçbir yeri yakmadan tamamen doldurabilen şey nedir?",
    opts: ["🕯️ Işık", "🪨 Taş", "💧 Su", "🕸️ Ağ"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Ne kadar çok kurutursa kendisi o kadar çok ıslanan eşya nedir?",
    opts: ["🧺 Havlu", "🧽 Sünger", "🧥 Pelerin", "🥾 Çizme"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Geceleyin çağrılmadan gelirler, gündüzleyin çalınmadan kaybolurlar. Gökyüzündeki bu misafirler kimdir?",
    opts: ["⭐ Yıldızlar", "🌧️ Bulutlar", "🦅 Kuşlar", "🍂 Yapraklar"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Bir kilitli kapıyı kırmadan, gürültü çıkarmadan açan en küçük şövalye nedir?",
    opts: ["🗝️ Anahtar", "🗡️ Kılıç", "🛡️ Kalkan", "🔨 Çekiç"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Sakladığın sürece senin kölendir, ağzından kaçırdığın an senin efendin olur. Nedir?",
    opts: ["🤫 Sır", "🪙 Altın", "🗡️ Hançer", "🕯️ Mum"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Ayakları olmadan şatonun tüm koridorlarında ıslık çalarak dolaşan şey nedir?",
    opts: ["💨 Rüzgâr", "🕯️ Şamdan", "🪑 Koltuk", "🖼️ Tablo"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Bir odada 4 köşe var, her köşede 1 kedi oturuyor ve her kedinin karşısında 3 kedi var. Odada toplam kaç kedi vardır?",
    opts: ["🐈 4 Kedi", "🐈 12 Kedi", "🐈 16 Kedi", "🐈 8 Kedi"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Dün yarın olsaydı bugün Cuma olurdu. Kâhya bu sözü hangi gün söylemiştir?",
    opts: ["📅 Çarşamba", "📅 Pazar", "📅 Perşembe", "📅 Cumartesi"],
    ans: 1
  },
  {
    kind: "RIDDLE",
    q: "İki baba ve iki oğul şato avlusunda yürüyor ama avluda yalnızca 3 kişi var. Nasıl olur?",
    opts: ["👨‍👦 Dede, Baba ve Torun", "👥 İkiz Kardeşler", "👻 Biri Hayalettir", "🪞 Aynaya Bakıyorlar"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Hangi soru sorulduğunda kimse dürüstçe 'Evet' cevabı veremez?",
    opts: ["😴 'Şu an uyuyor musun?'", "🍽️ 'Acıktın mı?'", "🏰 'Şatoda mısın?'", "🕯️ 'Üşüdün mü?'"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Önünde her zaman durur ama onu asla gözlerinle göremezsin. Nedir?",
    opts: ["⏳ Gelecek", "🪞 Ayna", "🚪 Kapı", "🔥 Şömine"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Uçak tam sınır çizgisine düşerse sağ kalanlar hangi ülkeye gömülür?",
    opts: ["🙌 Sağ kalanlar gömülmez!", "🧭 Kuzey ülkesine", "🧭 Güney ülkesine", "🏰 Tarafsız bölgeye"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Yalnızca tek bir elinle tutabileceğin ama diğer elinle asla tutamayacağın şey nedir?",
    opts: ["💪 Kendi dirseğin", "🗡️ Hançer", "🕯️ Fener", "🗝️ Anahtar"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Suyla dolu bir fıçıya ne koyarsan anında hafifler ve içinden su akar?",
    opts: ["🕳️ Delik", "🪨 Taş", "🪙 Altın", "🧂 Tuz"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Paylaştıkça eksilmek yerine daha da çoğalan en değerli hazine nedir?",
    opts: ["💡 Bilgi", "🪙 Altın Kesesi", "🍞 Somun Ekmek", "🕯️ Balmumu"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Karanlık çoğaldıkça daha net görünen şey nedir?",
    opts: ["⭐ Yıldızlar / Mum Alevi", "🖤 Siyah Pelerin", "👤 Gölge", "📜 Mürekkep"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Ne başlangıcı vardır ne de sonu; parmağa takıldığında bağlılığı simgeler. Nedir?",
    opts: ["💍 Halka / Yüzük", "🗡️ Kılıç", "🗝️ Anahtar", "🕯️ Şamdan"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Sofrada herkesin önünde durur, kesilir ama asla yenmez. Oyun kartlarıyla ilgilidir. Nedir?",
    opts: ["🃏 İskambil Destesi", "🍞 Somun Ekmek", "🧀 Teker Peynir", "🍎 Elma"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Camı kırmadan pencereden içeri giren şey nedir?",
    opts: ["☀️ Işık", "💨 Fırtına", "🐦‍⬛ Kuzgun", "🏹 Ok"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Üç şüpheliden Arda 'Ben masumum', Bora 'Arda yalan söylüyor', Cem 'Ben masumum' diyor. Yalnızca 1 Hain varsa ve sadece Hain yalan söylüyorsa kesin masum olan kimdir?",
    opts: ["Cem", "Arda", "Bora", "Bilinemez"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "İki camlı pencere, bakıp durur her yere. Gözümüze taktığımız bu yardımcı nedir?",
    opts: ["👓 Gözlük", "🪞 Ayna", "🔭 Dürbün", "⏳ Kum Saati"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Sıra sıra odalar, birbirini kovalar; demir yolda ilerler. Nedir?",
    opts: ["🚂 Tren", "🏰 Şato Kulesi", "🐎 At Arabası", "⛵ Kalyon"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Akşam ekerler, sabah biçerler; gökyüzü tarlasında parlayan bu taneler nedir?",
    opts: ["⭐ Yıldızlar", "🌾 Başaklar", "❄️ Kar Taneleri", "🔥 Kıvılcımlar"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Eğri çınar, yerden alır gökte yer. Uzun boylu bu hayvan hangisidir?",
    opts: ["🦒 Zürafa", "🐎 At", "🦌 Geyik", "🦅 Kartal"],
    ans: 0
  },
  {
    kind: "RIDDLE",
    q: "Bir çoban 17 koyunundan 9 tanesi hariç hepsini kaybederse kaç koyunu kalır?",
    opts: ["🐑 9 Koyun", "🐑 8 Koyun", "🐑 17 Koyun", "🐑 Hiç kalmaz"],
    ans: 0
  },

  // =========================================================================
  // BÖLÜM 2: KADİM RÜN, SEMBOL ÖRÜNTÜSÜ & SİMYA KÜRSÜSÜ (RUNE — 75 ADET)
  // =========================================================================
  {
    kind: "RUNE",
    q: "Kadim Döngü: 🌱 Tohum ➔ 🌿 Filiz ➔ 🌳 Ağaç ➔ ❓ (Sıradaki aşama hangisidir?)",
    opts: ["🍎 Meyve", "🪨 Kaya", "❄️ Buz", "🗡️ Çelik"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Zaman Mühürü: 🌅 Şafak ➔ ☀️ Öğle ➔ 🌇 Gün Batımı ➔ ❓",
    opts: ["🌙 Gece Yarısı", "🌧️ Sağanak", "🌈 Gökkuşağı", "🌪️ Kasırga"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Mevsim Çarkı: 🌸 İlkbahar ➔ ☀️ Yaz ➔ 🍂 Sonbahar ➔ ❓",
    opts: ["❄️ Kış", "🌱 Bahar", "🔥 Alev", "🌊 Deniz"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Simya Dönüşümü: 🧊 Buz ➔ 💧 Su ➔ ♨️ Buhar — Bu diziyi sağlayan etken nedir?",
    opts: ["🔥 Ateş / Isı", "🌑 Karanlık", "🪨 Toprak", "🗝️ Demir"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Rün Tekrarı: 🕯️ · 🗡️ · 🛡️ · 🕯️ · 🗡️ · ❓ (Sıradaki sembol hangisidir?)",
    opts: ["🛡️ Kalkan", "🕯️ Şamdan", "🗡️ Hançer", "👑 Taç"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Çift Rün Örüntüsü: 🐦‍⬛ 🐦‍⬛ · 🌕 · 🐦‍⬛ 🐦‍⬛ · 🌕 · ❓",
    opts: ["🐦‍⬛ Kuzgun", "🌕 Dolunay", "🩸 Kadeh", "🗝️ Anahtar"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Ay Evreleri: 🌑 Yeni Ay ➔ 🌓 İlk Dördün ➔ 🌕 Dolunay ➔ ❓",
    opts: ["🌗 Son Dördün", "☀️ Güneş", "⭐ Yıldız", "🌩️ Yıldırım"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Hanedan Hiyerarşisi: 🪖 Er ➔ ⚔️ Şövalye ➔ 🏰 Dük ➔ ❓",
    opts: ["👑 Kral", "🧹 Yamaç", "🕯️ Uşak", "🪵 Oduncu"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Simya Maden Sırası: 🥉 Bronz ➔ 🥈 Gümüş ➔ 🥇 Altın ➔ ❓",
    opts: ["💎 Elmas", "🪵 Tahta", "🪨 Kömür", "🧱 Tuğla"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Farklı Olanı Bul: [🗡️ Hançer] · [⚔️ Kılıç] · [🏹 Yay] · [🕯️ Şamdan] — Hangisi silah değildir?",
    opts: ["🕯️ Şamdan", "🗡️ Hançer", "⚔️ Kılıç", "🏹 Yay"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Farklı Olanı Bul: [🦅 Kartal] · [🐦‍⬛ Kuzgun] · [🦉 Baykuş] · [🐺 Kurt] — Hangisi uçamaz?",
    opts: ["🐺 Kurt", "🦅 Kartal", "🐦‍⬛ Kuzgun", "🦉 Baykuş"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Simya Karşıtlığı: 🔥 Ateş ⟷ 💧 Su ise ☀️ Aydınlık ⟷ ❓",
    opts: ["🌑 Karanlık", "💨 Rüzgâr", "🪨 Toprak", "🌿 Orman"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Mühür İlişkisi: 🗝️ Anahtar ➔ 🚪 Kapı ise 🪶 Tüy Kalem ➔ ❓",
    opts: ["📜 Parşömen", "🛡️ Kalkan", "🔥 Şömine", "🍷 Kadeh"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Şato Eşleşmesi: 👑 Taç ➔ Baş ise 💍 Mühür Yüzüğü ➔ ❓",
    opts: ["🖐️ Parmak", "🦶 Ayak", "🧥 Omuz", "🛡️ Kemer"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Harf Şifresi: A ➔ C ➔ E ➔ G ➔ ❓ (İngiliz/Latin alfabesinde bir harf atlayarak sıradaki nedir?)",
    opts: ["I", "H", "J", "K"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Ayna Şifresi: 'K A L E' kelimesinin aynadaki ters yazılışı hangisidir?",
    opts: ["E L A K", "K E L A", "L A K E", "A L E K"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Şifreli Parşömen: 'Z A R F' kelimesinin tersten okunuşu hangisidir?",
    opts: ["F R A Z", "R A F Z", "Z F R A", "F A R Z"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Karışık Harfler: [ K - U - Z - G - U - N ] harflerinden oluşan şato kuşu hangisidir?",
    opts: ["🐦‍⬛ KUZGUN", "🦅 ŞAHİN", "🦉 BAYKUŞ", "🕊️ GÜVERCİN"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Karışık Harfler: [ H - A - N - Ç - E - R ] harfleriyle yazılan gizli eşya nedir?",
    opts: ["🗡️ HANÇER", "🛡️ KALKAN", "🪖 MİĞFER", "🕯️ ŞAMDAN"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Karışık Harfler: [ M - Ü - H - Ü - R ] harfleriyle açılan kelime hangisidir?",
    opts: ["📜 MÜHÜR", "🗝️ KİLİT", "👑 KÜRSÜ", "🕯️ FENER"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Simya Renk Karışımı: 🔴 Kızıl İksir + 🟡 Altın İksir karıştırılırsa hangi renk parlar?",
    opts: ["🟠 Turuncu", "🟣 Mor", "🟢 Yeşil", "🔵 Lacivert"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Simya Renk Karışımı: 🔵 Safir İksir + 🟡 Kehribar İksir karıştırılırsa hangi renk oluşur?",
    opts: ["🟢 Zümrüt Yeşili", "🟣 Mor", "🔴 Kızıl", "⚪ Beyaz"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Simya Renk Karışımı: 🔴 Yakut İksir + 🔵 Safir İksir karıştırılırsa hangi renk doğar?",
    opts: ["🟣 Eflatun / Mor", "🟢 Yeşil", "🟡 Sarı", "🟤 Kahverengi"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Dört Element Kürsüsü: 🔥 Ateş · 💧 Su · 💨 Hava · ❓ (Eksik dördüncü kadim element nedir?)",
    opts: ["🪨 Toprak", "⚡ Yıldırım", "❄️ Kırağı", "🌙 Gölge"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Pusula Rünü: Kuzey'e bakan bir şövalye tam sağa (90°) dönerse hangi yöne bakar?",
    opts: ["➡️ Doğu", "⬅️ Batı", "⬇️ Güney", "⬆️ Kuzey"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Pusula Rünü: Batı'ya yürüyen bir davetli geriye (180°) dönerse hangi yöne yürür?",
    opts: ["➡️ Doğu", "⬆️ Kuzey", "⬇️ Güney", "⬅️ Batı"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Pusula Rünü: Güneş sabah Doğu'dan doğduğunda şato kulesinin gölgesi hangi yöne düşer?",
    opts: ["⬅️ Batı", "➡️ Doğu", "⬆️ Kuzey", "⬇️ Güney"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Simya Terazisi: 2 Beyaz Zarf + 1 Kırmızı Zarf = 11 gr, 1 Beyaz + 1 Kırmızı = 8 gr ise Kırmızı Zarf kaç gramdır?",
    opts: ["5 Gram", "3 Gram", "6 Gram", "4 Gram"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Rün Sayacı: 🕯️ = 4, 🗝️ = 7 ise (🕯️ + 🗝️ + 🕯️) işleminin sonucu kaçtır?",
    opts: ["15", "11", "18", "14"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Rün Sayacı: 👑 = 10, 🗡️ = 3 ise (👑 × 2 - 🗡️) kaç eder?",
    opts: ["17", "13", "23", "16"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Rün Sayacı: 🛡️ + 🛡️ = 12 ve 🛡️ + 🏹 = 10 ise 🏹 kaçtır?",
    opts: ["4", "6", "5", "8"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Rün Sayacı: 3 adet 🍷 Kadeh = 18 altın ise, 2 adet 🍷 Kadeh kaç altındır?",
    opts: ["12 Altın", "9 Altın", "15 Altın", "6 Altın"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Üçlü Mühür Sırası: 🔴 · 🔵 · 🟡 · 🔴 · 🔵 · ❓ (Sıradaki mühür rengi nedir?)",
    opts: ["🟡 Sarı", "🔴 Kırmızı", "🔵 Mavi", "🟢 Yeşil"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Artan Rün Sırası: ⭐ · ⭐⭐ · ⭐⭐⭐ · ❓ (Dördüncü halkada kaç yıldız olur?)",
    opts: ["⭐⭐⭐⭐ (4)", "⭐⭐ (2)", "⭐⭐⭐⭐⭐ (5)", "⭐ (1)"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Simetri Rünü: [ 🗡️  🛡️  👑  🛡️  ❓ ] dizisinin tam simetrik olması için sona ne gelmelidir?",
    opts: ["🗡️ Hançer", "👑 Taç", "🛡️ Kalkan", "🗝️ Anahtar"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Simetri Rünü: [ 🕯️  🐦‍⬛  🔮  🔮  🐦‍⬛  ❓ ] dizisini tamamlayan rün hangisidir?",
    opts: ["🕯️ Şamdan", "🔮 Küre", "🐦‍⬛ Kuzgun", "🩸 Kadeh"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Eşya & Mekan: 📚 Parşömen ➔ Kütüphane ise 🍷 Şerbet Kazanı ➔ ❓",
    opts: ["🍖 Mutfak / Kiler", "🛏️ Yatak Odası", "🗼 Gözetleme Kulesi", "⚔️ Cephanelik"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Ses İlişkisi: 🔔 Çan ➔ Çınlar ise 🚪 Eski Ahşap Kapı ➔ ❓",
    opts: ["🪵 Gıcırdar", "🔥 Parlar", "❄️ Donar", "🌊 Dalgalanır"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "İz İlişkisi: 🔥 Ateş ➔ Kül bırakır; peki 🌧️ Yağmur toprakta ne bırakır?",
    opts: ["🐾 Çamur / Islaklık", "💨 Duman", "🪨 Mermer", "🕯️ İs"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Üretim Zinciri: 🌾 Buğday ➔ 🥣 Un ➔ ❓ (Mutfak fırınından ne çıkar?)",
    opts: ["🍞 Ekmek", "🧀 Peynir", "🍷 Şarap", "🍯 Bal"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Üretim Zinciri: 🐝 Arı ➔ 🌸 Çiçek Özü ➔ ❓ (Kovanda neye dönüşür?)",
    opts: ["🍯 Bal", "🥛 Süt", "🫒 Zeytinyağı", "🧂 Tuz"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Üretim Zinciri: 🍇 Üzüm Bağı ➔ 🏺 Mahzen Fıçısı ➔ ❓",
    opts: ["🍷 Şıra / Şarap", "🍞 Somun", "🕯️ Balmumu", "🧥 İpek"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Sözcük Bağı: 🐦‍⬛ Kuş ➔ Kanat ise 🐟 Balık ➔ ❓",
    opts: ["🌊 Yüzgeç", "🐾 Pençe", "🦌 Boynuz", "🪶 Tüy"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Zırh Eşleşmesi: 🪖 Miğfer ➔ Baş korur; 🛡️ Göğüs Zırhı nereyi korur?",
    opts: ["❤️ Gövde / Kalp", "🦶 Ayak Bileği", "🖐️ Parmaklar", "👂 Kulak"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Farklı Olanı Seç: [🥇 Altın] · [🥈 Gümüş] · [⛓️ Demir] · [🪵 Meşe Odunu] — Hangisi metal değildir?",
    opts: ["🪵 Meşe Odunu", "🥇 Altın", "🥈 Gümüş", "⛓️ Demir"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Farklı Olanı Seç: [🕯️ Mum] · [🔥 Meşale] · [🏮 Fener] · [🗝️ Anahtar] — Hangisi ışık vermez?",
    opts: ["🗝️ Anahtar", "🕯️ Mum", "🔥 Meşale", "🏮 Fener"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Farklı Olanı Seç: [🎻 Kemancı] · [🎺 Borazan] · [🥁 Davul] · [🛡️ Kalkan] — Hangisi müzik aleti değildir?",
    opts: ["🛡️ Kalkan", "🎻 Kemancı", "🎺 Borazan", "🥁 Davul"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Gölge Şifresi: ŞİFRE kelimesinde her harfin sırası (Ş-İ-F-R-E) ise 3. harf hangisidir?",
    opts: ["F", "İ", "R", "E"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Palindrom Mühürü: Tersten okunuşu da kendisiyle birebir aynı olan kelime hangisidir?",
    opts: ["KABAK", "ŞATO", "KUZGUN", "SOFRA"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Palindrom Mühürü: Aşağıdaki kelimelerden hangisi düzden ve tersten aynı okunur?",
    opts: ["KÜÇÜK", "MASUM", "MÜHÜR", "KADEH"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Simya Denklemi: 1 🔮 Küre = 2 📜 Parşömen, 1 📜 Parşömen = 3 🕯️ Mum ise 1 🔮 Küre kaç 🕯️ Mum eder?",
    opts: ["6 Mum", "5 Mum", "4 Mum", "9 Mum"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Takas Masası: 1 👑 Taç = 2 🗡️ Kılıç, 1 🗡️ Kılıç = 4 🪙 Altın ise 1 👑 Taç kaç 🪙 Altın değerindedir?",
    opts: ["8 Altın", "6 Altın", "10 Altın", "4 Altın"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Harf Örüntüsü: B ➔ D ➔ F ➔ H ➔ ❓ (İngiliz alfabesinde sıradaki harf nedir?)",
    opts: ["J", "I", "K", "L"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Geriye Harf Rünü: Z ➔ Y ➔ X ➔ W ➔ ❓",
    opts: ["V", "U", "T", "S"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Kuzgun İzi: ⬆️ · ➡️ · ⬇️ · ⬅️ · ⬆️ · ❓ (Saat yönünde dönen okun sıradaki yönü nedir?)",
    opts: ["➡️ Sağ", "⬇️ Aşağı", "⬅️ Sol", "⬆️ Yukarı"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Ters Çark: ⬆️ · ⬅️ · ⬇️ · ➡️ · ⬆️ · ❓ (Saat yönünün tersine dönen okun sıradaki yönü nedir?)",
    opts: ["⬅️ Sol", "➡️ Sağ", "⬇️ Aşağı", "⬆️ Yukarı"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Simya Sıralaması (Küçükten Büyüğe): 💧 Damla ➔ 🪣 Kova ➔ 🌊 Göl ➔ ❓",
    opts: ["🌍 Okyanus", "🥄 Kaşık", "🥛 Bardak", "🌧️ Çiy"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Işık Şiddeti (Azdan Çoğa): ✨ Kıvılcım ➔ 🕯️ Mum ➔ 🔥 Şömine ➔ ❓",
    opts: ["☀️ Güneş", "🌑 Gölge", "🏮 Sönük Fener", "💨 Duman"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Zaman Ölçeği: Saniye ➔ Dakika ➔ Saat ➔ Gün ➔ ❓ (Haftadan önce değil, Günden hemen sonra gelen hangisidir?)",
    opts: ["📅 Hafta", "📆 Yüzyıl", "⏳ Salise", "🌙 Mevsim"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Romen Rünü: I · II · III · IV · V · ❓ (Altıyı gösteren Romen rakamı hangisidir?)",
    opts: ["VI", "IV", "IX", "VII"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Romen Rünü: X = 10 ve V = 5 ise 'XV' mührü hangi sayıyı temsil eder?",
    opts: ["15", "50", "5", "25"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Romen Rünü: 'IX' sembolü şato saatinde kaçı gösterir?",
    opts: ["9", "11", "4", "6"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Romen Rünü: 'XII' sembolü kule saatinde kaçı gösterir?",
    opts: ["12", "7", "10", "14"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Kütüphane Şifresi: SOFRA = 5 harf, ŞATO = 4 harf, KARGALI = 7 harf ise (SOFRA + ŞATO) kaç harftir?",
    opts: ["9", "8", "11", "10"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Mühürlü Kutu: Kırmızı kutu Mavi kutunun içinde, Mavi kutu Altın sandığın içindeyse en dışta hangisi vardır?",
    opts: ["🟨 Altın Sandık", "🟦 Mavi Kutu", "🟥 Kırmızı Kutu", "🗝️ Anahtar"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Kule Katları: Kütüphane Zindan'ın üstünde, Gözetleme Kulesi Kütüphane'nin üstündeyse en altta neresi vardır?",
    opts: ["⛓️ Zindan", "📚 Kütüphane", "🗼 Gözetleme Kulesi", "🌤️ Çatı"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Koltuk Sırası: Ali, Bora'nın solunda; Bora da Cem'in solundaysa ortada kim oturuyordur?",
    opts: ["Bora", "Ali", "Cem", "Kâhya"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "İksir Rafı: Yeşil şişe en solda değil, Kırmızı şişe en sağda ve toplam 3 şişe (Mavi, Yeşil, Kırmızı) varsa ortada hangisi durur?",
    opts: ["🟢 Yeşil Şişe", "🔵 Mavi Şişe", "🔴 Kırmızı Şişe", "⚪ Boş Şişe"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Gece Parolası: 'KUZGUN' kelimesindeki sesli harfler çıkarılırsa geriye hangi harf dizisi kalır?",
    opts: ["K - Z - G - N", "K - U - Z - N", "Z - G - U - N", "K - G - N"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Simya Oranı: Bir uyku iksiri için 2 damla lavanta ve 3 damla papatya gerekiyorsa, 2 şişe iksir için toplam kaç damla gerekir?",
    opts: ["10 Damla", "5 Damla", "8 Damla", "12 Damla"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Kadim Rün Dizilimi: 🐦‍⬛ Kuzgun ➔ 🕯️ Şamdan ➔ 🗝️ Anahtar ➔ 🩸 Kadeh ➔ 🐦‍⬛ Kuzgun ➔ ❓",
    opts: ["🕯️ Şamdan", "🗝️ Anahtar", "🩸 Kadeh", "👑 Taç"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Çift Katmanlı Şifre: 1A · 2B · 3C · 4D · ❓",
    opts: ["5E", "4E", "5D", "6F"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Azalan Çift Şifre: 9Z · 8Y · 7X · ❓",
    opts: ["6W", "6V", "5W", "7W"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Kalkan Arması: Üçgen = 3 kenar, Kare = 4 kenar, Beşgen = 5 kenar ise Altıgen armasında kaç kenar vardır?",
    opts: ["6 Kenar", "8 Kenar", "5 Kenar", "7 Kenar"],
    ans: 0
  },
  {
    kind: "RUNE",
    q: "Satranç Rünü: Satranç tahtasında yalnızca 'L' şeklinde diğer taşların üzerinden atlayabilen taş hangisidir?",
    opts: ["♞ At", "♜ Kale", "♝ Fil", "♛ Vezir"],
    ans: 0
  },

  // =========================================================================
  // BÖLÜM 3: ŞATO SAATİ, KASA ŞİFRESİ & HIZLI ZİHİN HESABI (CLOCK — 70 ADET)
  // =========================================================================
  {
    kind: "CLOCK",
    q: "Gece yarısı çanı 12 kez vurduğunda akrep XII üzerinde, yelkovan tam karşısındaki VI üzerindeyse saat kaçtır?",
    opts: ["12:30", "06:00", "12:00", "06:30"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Şato saati şu an 09:45'i gösteriyorsa 30 dakika sonra saat kaç olur?",
    opts: ["10:15", "10:05", "10:30", "09:15"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Şölen 20:20'de başladı ve tam 50 dakika sürdü. Şölen saat kaçta bitti?",
    opts: ["21:10", "21:00", "20:70", "21:20"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Gece nöbeti 23:40'ta başladı ve 35 dakika sürdü. Nöbet bittiğinde saat kaçtır?",
    opts: ["00:15", "00:05", "23:55", "00:25"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Kule çanı her 15 dakikada bir çalıyorsa 1 saat içinde (başlangıç hariç) kaç kez çalar?",
    opts: ["4 Kez", "3 Kez", "5 Kez", "6 Kez"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Sayı Dizisi Kilidi: 2 - 4 - 8 - 16 - ❓ (Sıradaki sayı kaçtır?)",
    opts: ["32", "24", "20", "64"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Sayı Dizisi Kilidi: 3 - 6 - 12 - 24 - ❓ (Sıradaki sayı kaçtır?)",
    opts: ["48", "36", "30", "42"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Fibonacci Kasa Şifresi: 1 - 1 - 2 - 3 - 5 - 8 - ❓ (Son iki sayının toplamıyla ilerleyen sıradaki sayı kaçtır?)",
    opts: ["13", "11", "12", "15"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Kare Sayılar Kilidi: 1 - 4 - 9 - 16 - 25 - ❓ (Sıradaki tam kare sayı kaçtır?)",
    opts: ["36", "30", "32", "49"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Azalan Kasa Şifresi: 100 - 91 - 82 - 73 - ❓ (Her adımda 9 azalan sıradaki sayı kaçtır?)",
    opts: ["64", "63", "65", "54"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Artan Adım Şifresi: 2 - 5 - 9 - 14 - 20 - ❓ (+3, +4, +5, +6... sıradaki kaçtır?)",
    opts: ["27", "26", "28", "25"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Çift Yönlü Kilit: 81 - 27 - 9 - 3 - ❓ (Her adımda üçe bölünen sıradaki sayı kaçtır?)",
    opts: ["1", "0", "2", "3"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Şamdan Bilmecesi: Salonda 10 mum yanıyordu. Fırtına pencereden esip 3 tanesini söndürdü. Sabaha kadar hiç dokunulmazsa geriye kaç mum KALIR?",
    opts: ["🕯️ 3 Mum (Diğer 7'si eriyip biter)", "🕯️ 7 Mum", "🕯️ 10 Mum", "🕯️ Hiç kalmaz"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Hazine Kasası: Kasada 120 altın var. Önce yarısı harcandı, sonra kalanlara 35 altın eklendi. Kasada kaç altın oldu?",
    opts: ["95 Altın", "85 Altın", "75 Altın", "105 Altın"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Muhafız Devriyesi: 5 muhafız 5 koridoru 5 dakikada kontrol ediyorsa, 10 muhafız 10 koridoru aynı hızla kaç dakikada kontrol eder?",
    opts: ["5 Dakika", "10 Dakika", "2 Dakika", "50 Dakika"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Fırın Bilmecesi: 3 somun ekmek taş fırında 18 dakikada pişiyorsa, aynı fırına birlikte konan 6 somun ekmek kaç dakikada pişer?",
    opts: ["18 Dakika", "36 Dakika", "9 Dakika", "24 Dakika"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Nilüfer Göleti: Şato havuzundaki nilüferler her gün iki katına çıkıyor. Havuz 20. günde tamamen dolduğuna göre yarısı kaçıncı günde dolmuştur?",
    opts: ["19. Günde", "10. Günde", "15. Günde", "18. Günde"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Kule Merdiveni: Her kat arasında 15 basamak varsa, 1. kattan 4. kata çıkan bir davetli toplam kaç basamak çıkar?",
    opts: ["45 Basamak", "60 Basamak", "30 Basamak", "75 Basamak"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Odun Kesimi: Bir kütüğü 4 eşit parçaya ayırmak için baltayla kaç kesim yapmak gerekir?",
    opts: ["3 Kesim", "4 Kesim", "2 Kesim", "5 Kesim"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Şato Saati Şifresi: [Kâhya Koltuğu #11] + [10 Kişideki Hain Sayısı: 2] toplamı kaçtır?",
    opts: ["13", "12", "14", "11"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Zihin Hesabı: (8 × 7) - 16 işleminin sonucu kaçtır?",
    opts: ["40", "42", "38", "48"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Zihin Hesabı: (9 × 6) + 11 işleminin sonucu kaçtır?",
    opts: ["65", "63", "55", "75"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Zihin Hesabı: 144 altın 12 şövalyeye eşit paylaştırılırsa kişi başı kaç altın düşer?",
    opts: ["12 Altın", "14 Altın", "11 Altın", "16 Altın"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Zihin Hesabı: (25 × 4) - 37 işleminin sonucu kaçtır?",
    opts: ["63", "73", "67", "53"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Zihin Hesabı: Bir sayının 3 katının 5 fazlası 26 ise bu sayı kaçtır?",
    opts: ["7", "8", "6", "9"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Zihin Hesabı: Bir sayının yarısı ile kendisinin toplamı 30 ise bu sayı kaçtır?",
    opts: ["20", "15", "18", "24"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Yaş Bilmecesi: Kâhya 40, çırağı 12 yaşındadır. 5 yıl sonra yaşları toplamı kaç olur?",
    opts: ["62", "57", "52", "67"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Yaş Farkı: Abi 18, kardeşi 11 yaşındadır. 20 yıl sonra aralarındaki yaş farkı kaç olur?",
    opts: ["7", "27", "14", "20"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Tokalaşma Bilmecesi: Yuvarlak masadaki 4 davetli birbiriyle birer kez el sıkışırsa toplam kaç tokalaşma gerçekleşir?",
    opts: ["6", "8", "4", "12"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Kuyudan Çıkış: 10 metrelik kuyudaki kurbağa gündüz 3 metre çıkıyor, gece 2 metre kayıyor. Kuyudan kaçıncı günde çıkar?",
    opts: ["8. Günde", "10. Günde", "9. Günde", "7. Günde"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Kum Saati: 7 dakikalık ve 4 dakikalık iki kum saatini aynı anda çevirirsen aralarındaki farkla kaç dakikayı tam ölçersin?",
    opts: ["3 Dakika", "2 Dakika", "5 Dakika", "6 Dakika"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Saat Aynası: Akrep tam 3'ün, yelkovan 12'nin üzerindeyse aralarındaki küçük açı kaç derecedir?",
    opts: ["90°", "60°", "120°", "45°"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Saat Aynası: Saat tam 06:00 iken akrep ile yelkovan arasındaki açı kaç derecedir?",
    opts: ["180°", "90°", "120°", "360°"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Çiftlik Hesabı: Avluda toplam 6 baş (at ve tavuk karışık) ve 18 ayak sayıldı. Avluda kaç at vardır?",
    opts: ["3 At (ve 3 Tavuk)", "4 At", "2 At", "5 At"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Çorap Çekmecesi: Karanlık odada çekmecede 6 siyah ve 6 beyaz eldiven teki (aynı kalıp) var. Kesinlikle aynı renkten 1 çift tutturmak için en az kaç adet çekmelisin?",
    opts: ["3 Adet", "2 Adet", "4 Adet", "7 Adet"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Kasa Kombinasyonu: Rakamları toplamı 12 olan ve rakamları birbirinden farklı en büyük iki basamaklı sayı kaçtır?",
    opts: ["93", "84", "66", "94"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Kasa Kombinasyonu: Rakamları çarpımı 24 olan en küçük iki basamaklı doğal sayı kaçtır?",
    opts: ["38", "46", "29", "64"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Sayı Örüntüsü: 5 - 10 - 20 - 40 - ❓",
    opts: ["80", "60", "70", "100"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Dalgalı Dizi: 10 - 13 - 11 - 14 - 12 - ❓ (+3, -2, +3, -2 kuralına göre sıradaki kaçtır?)",
    opts: ["15", "10", "16", "13"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Dalgalı Dizi: 20 - 18 - 22 - 20 - 24 - ❓ (-2, +4, -2, +4 kuralına göre sıradaki kaçtır?)",
    opts: ["22", "26", "28", "20"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Asal Kilit: 2 - 3 - 5 - 7 - 11 - 13 - ❓ (Sıradaki asal sayı hangisidir?)",
    opts: ["17", "15", "19", "14"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Küp Kasa Şifresi: 1 - 8 - 27 - ❓ (1³, 2³, 3³... sıradaki 4³ kaçtır?)",
    opts: ["64", "36", "48", "81"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Altın Kesesi: Her gün kasaya önceki gün koyduğunun 2 altın fazlasını koyuyorsun. 1. gün 3 altın koyduysan 4. gün kaç altın koyarsın?",
    opts: ["9 Altın", "7 Altın", "8 Altın", "11 Altın"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Toplam Altın: 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 toplamı kaçtır?",
    opts: ["55", "45", "50", "60"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Yarım Bölme: 30 sayısını yarıma (0.5'e) bölüp 10 eklersen sonuç kaç çıkar?",
    opts: ["70", "25", "40", "55"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Çan Vuruşu: Saat çanı 3 vuruşu toplam 4 saniyede tamamlıyorsa (arada 2 boşluk var!), 5 vuruşu (4 boşluk) kaç saniyede tamamlar?",
    opts: ["8 Saniye", "6 Saniye", "10 Saniye", "7 Saniye"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Anahtarlık Halkası: 8 odanın kilitli kapısı ve elinde karışık 8 anahtar var. İlk kapıyı açmayı garantilemek için en kötü ihtimalle kaç deneme gerekir?",
    opts: ["7 veya 8 Deneme (8. kesin açar)", "4 Deneme", "2 Deneme", "16 Deneme"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Karanlık Mahzen: 3 kedi 3 fareyi 3 dakikada yakalıyorsa, 9 kedi 9 fareyi kaç dakikada yakalar?",
    opts: ["3 Dakika", "9 Dakika", "1 Dakika", "27 Dakika"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Hız Hesabı: Saatte 60 km hızla giden bir posta arabası 90 km yolu kaç dakikada alır?",
    opts: ["90 Dakika", "60 Dakika", "120 Dakika", "75 Dakika"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Takvim Kilidi: Bugün günlerden Salı ise 10 gün sonra haftanın hangi günü olur?",
    opts: ["Cuma", "Perşembe", "Cumartesi", "Çarşamba"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Takvim Kilidi: Bugün Pazar ise 15 gün sonra hangi gün olur?",
    opts: ["Pazartesi", "Pazar", "Salı", "Cumartesi"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Simya Yüzdesi: 200 gramlık bir iksirin %25'i saf gümüş tozuysa içinde kaç gram gümüş tozu vardır?",
    opts: ["50 Gram", "25 Gram", "40 Gram", "75 Gram"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Zırh İndirimi: 80 altınlık bir şövalye miğferine %25 indirim yapılırsa yeni fiyatı kaç altın olur?",
    opts: ["60 Altın", "55 Altın", "65 Altın", "50 Altın"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Çevre Hesabı: Bir kenarı 9 metre olan kare şeklindeki şato avlusunun tam çevresi kaç metredir?",
    opts: ["36 Metre", "81 Metre", "18 Metre", "27 Metre"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Alan Hesabı: Uzun kenarı 8 metre, kısa kenarı 5 metre olan dikdörtgen ziyafet salonunun alanı kaç metrekaredir?",
    opts: ["40 m²", "26 m²", "45 m²", "35 m²"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Üçgen Açısı: Bir üçgenin iki iç açısı 60° ve 50° ise üçüncü açısı kaç derecedir?",
    opts: ["70°", "80°", "60°", "90°"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Kalan Mum: 12 saatte tamamen eriyen bir mumun 4 saat sonunda kaçta kaçı erimiş olur?",
    opts: ["Üçte biri (1/3)", "Yarısı (1/2)", "Dörtte biri (1/4)", "Üçte ikisi (2/3)"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Kasa Şifresi: 1'den 20'ye kadar (20 dahil) kaç tane ÇİFT sayı vardır?",
    opts: ["10 Tane", "9 Tane", "11 Tane", "8 Tane"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "9 Rakamı Sayacı: 1'den 100'e kadar yazarken '9' rakamını toplam kaç kez yazarız? (Dikkat: 90-99 arası dahil!)",
    opts: ["20 Kez", "10 Kez", "19 Kez", "11 Kez"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Şato Kapıları: 14 odanın 4'ü kilitli ve kalanların tam yarısı açıksa kaç oda kapısı şu an açıktır?",
    opts: ["5 Kapı", "7 Kapı", "6 Kapı", "4 Kapı"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Nöbetçi Hesabı: 12 odanın 4'ü kilitli ve kalan odaların tam yarısının ışığı yanıyorsa kaç odanın ışığı yanıyordur?",
    opts: ["4 Oda", "6 Oda", "8 Oda", "2 Oda"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Zihin Hesabı: (15 × 3) - (12 × 2) işleminin sonucu kaçtır?",
    opts: ["21", "19", "23", "27"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Zihin Hesabı: 72 ÷ 8 + 14 işleminin sonucu kaçtır?",
    opts: ["23", "21", "25", "19"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Zihin Hesabı: (11 × 11) - 21 işleminin sonucu kaçtır?",
    opts: ["100", "99", "110", "90"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "İki Kardeşin Altını: Arda, Berk'e 10 altın verirse ikisinin altını eşitleniyor. Başlangıçta Arda'nın Berk'ten kaç altın fazlası vardır?",
    opts: ["20 Altın", "10 Altın", "15 Altın", "5 Altın"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Sıra Hesabı: Yemek kuyruğunda baştan 6. ve sondan 6. sıradaysan kuyrukta toplam kaç kişi vardır?",
    opts: ["11 Kişi", "12 Kişi", "10 Kişi", "13 Kişi"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Kitap Sayfaları: Bir günlüğün 10. sayfasından 20. sayfasına kadar (10 ve 20 dahil) okursan toplam kaç sayfa okumuş olursun?",
    opts: ["11 Sayfa", "10 Sayfa", "9 Sayfa", "12 Sayfa"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Bölünmeyen Altın: 50 altını 7 keseye eşit koymaya çalışırsan dışarıda kaç altın artar?",
    opts: ["1 Altın (7×7=49)", "2 Altın", "3 Altın", "Hiç artmaz"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Üçlü Çarpım: 2 × 3 × 4 × 5 işleminin sonucu kaçtır?",
    opts: ["120", "60", "100", "140"],
    ans: 0
  },
  {
    kind: "CLOCK",
    q: "Eksik Rakam: [ 7 · 14 · 21 · ❓ · 35 · 42 ] dizisinde soru işareti yerine hangi sayı gelmelidir?",
    opts: ["28", "27", "29", "30"],
    ans: 0
  }
];
