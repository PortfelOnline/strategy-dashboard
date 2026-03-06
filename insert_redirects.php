<?php
$opts = [PDO::MYSQL_ATTR_SSL_CA => '/application/docker/settings/mysql/root.crt', PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT => false];
$pdo = new PDO('mysql:host=master.8c1b7f3b-4a56-44e9-a96c-52b38ad21871.c.dbaas.selcloud.ru;dbname=admin_kadas_f;charset=utf8', 'admin_kadas_4', 'y1r5UYo_4G', $opts);

$redirects = [
  ['/kadastr/kak-najti-uchastok-po-kadastrovomu-nomeru-onlajn-besplatno/', 'https://kadastrmap.info/kadastr/kak-najti-uchastok-po-kadastrovomu-nomeru/'],
  ['/kadastr/kak-zakazat-vypisku-iz-egrn-dlya-fizicheskih-lits-na-kvartiru/', 'https://kadastrmap.info/kadastr/kak-zakazat-vypisku-iz-egrn-dlya-fizicheskih-lits/'],
  ['/kadastr/gde-vzyat-vypisku-egrn-na-kvartiru-v-moskve/', 'https://kadastrmap.info/kadastr/gde-vzyat-vypisku-iz-egrn-na-kvartiru/'],
  ['/kadastr/kak-uznat-kadastrovuyu-stoimost-obekta-nedvizhimosti-po-adresuu/', 'https://kadastrmap.info/kadastr/kak-uznat-kadastrovuyu-stoimost-obekta-nedvizhimosti-po-adresu/'],
  ['/kadastr/kak-oformit-kadastrovyj-pasport-na-dachnyj-uchastok/', 'https://kadastrmap.info/kadastr/kak-oformit-kadastrovyj-pasport-na-dachnyj-dom/'],
  ['/kadastr/kak-zakazat-vypisku-iz-egrp-cherez-gosuslugi/', 'https://kadastrmap.info/kadastr/kak-zakazat-vypisku-iz-egrp-cherez-mfts/'],
  ['/kadastr/kak-zakazat-vypisku-iz-egrp-cherez-internet/', 'https://kadastrmap.info/kadastr/kak-zakazat-vypisku-iz-egrp-cherez-mfts/'],
  ['/kadastr/kak-oformit-kadastrovyj-pasport-na-kvartiru-v-novostrojke/', 'https://kadastrmap.info/kadastr/kak-oformit-kadastrovyj-pasport-na-kvartiru/'],
  ['/kadastr/zakazat-kadastrovyj-pasport-na-zemelnyj-uchastok-onlajn-v-rosreestre/', 'https://kadastrmap.info/kadastr/zakazat-kadastrovyj-pasport-na-zemelnyj-uchastok/'],
  ['/kadastr/gde-zakazat-kadastrovyj-pasport-na-kvartiru-v-ekaterinburge/', 'https://kadastrmap.info/kadastr/gde-zakazat-kadastrovyj-pasport-na-kvartiru/'],
  ['/kadastr/skolko-stoit-zakazat-kadastrovyj-pasport-na-kvartiru/', 'https://kadastrmap.info/kadastr/skolko-stoit-zakazat-kadastrovyj-pasport-na-dom/'],
  ['/kadastr/kak-poluchit-kadastrovyj-pasport-na-zdanie-yuridicheskomu-litsu/', 'https://kadastrmap.info/kadastr/kak-poluchit-kadastrovyj-pasport-na-zdanie/'],
  ['/kadastr/zakazat-kadastrovuyu-vypisku-na-zemelnyj-uchastok-v-elektronnom-vide/', 'https://kadastrmap.info/kadastr/zakazat-kadastrovuyu-vypisku-na-zemelnyj-uchastok/'],
  ['/kadastr/chto-takoe-kadastrovyj-pasport-na-kvartiru-gde-poluchat/', 'https://kadastrmap.info/kadastr/chto-takoe-kadastrovyj-pasport-na-kvartiru/'],
  ['/kadastr/kak-poluchit-kadastrovyj-pasport-na-garazh-v-gsk/', 'https://kadastrmap.info/kadastr/kak-poluchit-kadastrovyj-pasport-na-garazh/'],
];

$stmt = $pdo->prepare('INSERT INTO 649T4eqvKo_irrp_redirections (`from`, `match`, `to`, status, timestamp, type) VALUES (?, \'url\', ?, 1, UNIX_TIMESTAMP(), \'redirect\')');
$ok = 0;
foreach ($redirects as $r) {
  $stmt->execute([$r[0], $r[1]]);
  echo '+ ' . $r[0] . "\n";
  $ok++;
}
echo "\nDone: $ok redirects inserted\n";
