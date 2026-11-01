// Star names for private repos. A repo always gets the same star: the name comes from
// a salted hash of the repo id, so nothing about the real name is used.
import { createHmac } from 'node:crypto';

const BASE = `Acamar Achernar Acrux Adhara Albireo Alcor Alcyone Aldebaran Alderamin Algenib Algieba Algol
Alhena Alioth Alkaid Almach Alnair Alnilam Alnitak Alphard Alphecca Alpheratz Alshain Altair Ankaa Antares
Arcturus Arneb Atria Avior Bellatrix Betelgeuse Canopus Capella Caph Castor Cursa Deneb Denebola Diphda
Dubhe Elnath Eltanin Enif Etamin Fomalhaut Gacrux Gienah Hadar Hamal Izar Kaus Kochab Markab Megrez Menkar
Merak Miaplacidus Mimosa Mintaka Mira Mirach Mirfak Mirzam Mizar Naos Nunki Peacock Phact Phecda Polaris
Pollux Procyon Propus Rasalhague Regulus Rigel Rukbat Sabik Saiph Sargas Scheat Schedar Shaula Sheratan
Sirius Spica Suhail Sulafat Tarazed Thuban Unukalhai Vega Vindemiatrix Wezen Zaurak Zubenelgenubi Alnasl
Ascella Aspidiske Atik Baten Chara Dschubba Edasich Furud Graffias Heze Homam Kornephoros Lesath Matar
Menkalinan Nihal Nashira Okab Pherkad Rastaban Sadr Sadalsuud Sadalmelik Tejat Tureis Yed Zosma Zavijava
Acubens Alchiba Alcor Algorab Alpheratz Alrai Alsephina Alterf Angetenar Arkab Azelfafage Biham Celbalrai
Chertan Cujam Dabih Dziban Elgafar Fulu Gomeisa Hassaleh Heka Ilia Jabbah Kajam Kraz Larawag Maasym
Marfik Matar Meissa Minkar Musica Nekkar Pipirima Rotanev Sarin Situla Tania Talitha Tiaki Vespertilio`.split(/\s+/).filter(Boolean);

// unique base names, then Roman-numeral variants so there is room for a few hundred repos
const UNIQUE = [...new Set(BASE)];
export const STAR_NAMES = [
  ...UNIQUE,
  ...UNIQUE.map((n) => `${n} II`),
  ...UNIQUE.map((n) => `${n} III`),
];

function slot(salt, id, mod) {
  const h = createHmac('sha256', salt).update(`repo:${id}`).digest();
  return h.readUIntBE(0, 6) % mod;
}

// ids: array of repo ids. returns Map(id -> star name). Stable for a given salt and id set;
// a collision moves the later id (sorted) to the next free name.
export function assignStarNames(ids, salt, reserved = new Set()) {
  if (!salt || salt.length < 16) throw new Error('STAR_SALT is missing or too short');
  const taken = new Set([...reserved].map((s) => s.toLowerCase()));
  const out = new Map();
  const sorted = [...ids].sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }));
  for (const id of sorted) {
    let i = slot(salt, id, STAR_NAMES.length);
    for (let tries = 0; tries < STAR_NAMES.length; tries++) {
      const name = STAR_NAMES[(i + tries) % STAR_NAMES.length];
      if (!taken.has(name.toLowerCase())) {
        taken.add(name.toLowerCase());
        out.set(id, name);
        break;
      }
    }
    if (!out.has(id)) throw new Error('Ran out of star names');
  }
  return out;
}
