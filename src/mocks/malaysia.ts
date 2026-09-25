// Synthetic Malaysian identity data. Faker has no Malaysian locale, so names/addresses come from these lists.
// NEVER real people: NRIC serials always use the fake "999G" pattern (MOCK-06), IPs come from RFC 5737 documentation ranges.
import type { Faker } from '@faker-js/faker'
import type { ClientMetadata, DocumentType, Pii } from '@/domain/types'

interface City {
  city: string
  postcode: [number, number]
}
interface State {
  code: string // NRIC place-of-birth code
  name: string
  cities: City[]
}

export const STATES: State[] = [
  { code: '01', name: 'Johor', cities: [{ city: 'Johor Bahru', postcode: [80000, 81300] }, { city: 'Batu Pahat', postcode: [83000, 83700] }] },
  { code: '02', name: 'Kedah', cities: [{ city: 'Alor Setar', postcode: [5000, 5460] }] },
  { code: '04', name: 'Melaka', cities: [{ city: 'Melaka', postcode: [75000, 75460] }] },
  { code: '05', name: 'Negeri Sembilan', cities: [{ city: 'Seremban', postcode: [70000, 70450] }] },
  { code: '06', name: 'Pahang', cities: [{ city: 'Kuantan', postcode: [25000, 26100] }] },
  { code: '07', name: 'Pulau Pinang', cities: [{ city: 'George Town', postcode: [10000, 11000] }, { city: 'Bayan Lepas', postcode: [11900, 11960] }] },
  { code: '08', name: 'Perak', cities: [{ city: 'Ipoh', postcode: [30000, 31650] }] },
  { code: '10', name: 'Selangor', cities: [{ city: 'Shah Alam', postcode: [40000, 40470] }, { city: 'Petaling Jaya', postcode: [46000, 47800] }, { city: 'Subang Jaya', postcode: [47500, 47650] }] },
  { code: '12', name: 'Sabah', cities: [{ city: 'Kota Kinabalu', postcode: [88000, 88999] }] },
  { code: '13', name: 'Sarawak', cities: [{ city: 'Kuching', postcode: [93000, 93990] }] },
  { code: '14', name: 'Wilayah Persekutuan Kuala Lumpur', cities: [{ city: 'Kuala Lumpur', postcode: [50000, 60000] }] },
]

// Weighted towards the Klang Valley, Johor and Penang.
const STATE_WEIGHTS: Record<string, number> = { '14': 5, '10': 6, '01': 4, '07': 3 }

const MALAY = {
  male: ['AHMAD FAIZ', 'MUHAMMAD HAFIZ', 'ALI', 'AMIRUL HAKIM', 'SYAFIQ', 'AZLAN', 'IKHWAN', 'MOHD RIDZUAN', 'HAZIQ', 'FIRDAUS'],
  female: ['NUR AISYAH', 'SITI AMINAH', 'NURUL HUDA', 'FARAH', 'AINA SOFEA', 'ZARINA', 'NOR AZLINA', 'NUR IMAN', 'HANIS', 'SYAHIRAH'],
  father: ['ZULKIFLI', 'RAHMAN', 'ISMAIL', 'YUSOF', 'HAMZAH', 'OTHMAN', 'KAMARUDDIN', 'ABDULLAH', 'ROSLI', 'MANSOR'],
}
const CHINESE = {
  surname: ['TAN', 'LIM', 'LEE', 'WONG', 'NG', 'CHONG', 'YAP', 'ONG', 'GOH', 'CHAN', 'TEH', 'LOW'],
  male: ['ZHENG YONG', 'WEI JIE', 'KAH HENG', 'JUN HAO', 'CHEE KEONG', 'BOON HOCK', 'YI XUAN', 'KOK WAI'],
  female: ['MEI LING', 'XIN YI', 'HUI MIN', 'PEI SHAN', 'SIEW LAN', 'JIA QI', 'LI WEN', 'YEE MUN'],
}
const INDIAN = {
  male: ['RAJESH', 'SURESH', 'KUMAR', 'ARJUN', 'VIGNESH', 'PRAKASH', 'SARAVANAN', 'DINESH'],
  female: ['KAVITHA', 'PRIYA', 'DEVI', 'SHANTHI', 'LAKSHMI', 'ANITHA', 'MALATHI', 'SANGEETHA'],
  father: ['MUTHU', 'SUBRAMANIAM', 'KRISHNAN', 'RAMASAMY', 'GANESAN', 'MANIAM', 'ARUMUGAM', 'PILLAI'],
}
const FOREIGN: { nationality: string; male: string[]; female: string[] }[] = [
  { nationality: 'INDONESIA', male: ['BUDI SANTOSO', 'AGUS PRASETYO', 'RIZKY PRATAMA'], female: ['SITI RAHAYU', 'DEWI LESTARI', 'PUTRI AYU'] },
  { nationality: 'BANGLADESH', male: ['MD RAHIM UDDIN', 'MOHAMMAD KARIM', 'ABDUL HASAN'], female: ['NUSRAT JAHAN', 'FATEMA BEGUM'] },
  { nationality: 'PHILIPPINES', male: ['JOSE REYES SANTOS', 'MARK ANTHONY CRUZ'], female: ['MARIA CRUZ DELA ROSA', 'ANGELICA BAUTISTA'] },
]

const STREETS = ['Mawar', 'Melati', 'Cempaka', 'Kenanga', 'Seroja', 'Dahlia', 'Anggerik', 'Bunga Raya', 'Setia', 'Bakti', 'Damai', 'Harmoni', 'Harmonium']
const TAMAN = ['Desa Tebrau', 'Sri Indah', 'Bukit Jaya', 'Seri Permai', 'Mewah', 'Sentosa', 'Universiti', 'Perling', 'Desa Aman', 'Bukit Indah']

export type Gender = Pii['gender']

export interface Person {
  documentType: DocumentType
  pii: Pii
  city: string
}

function pickState(f: Faker): State {
  return f.helpers.weightedArrayElement(STATES.map((s) => ({ value: s, weight: STATE_WEIGHTS[s.code] ?? 1 })))
}

export function postcodeFor(f: Faker, c: City): string {
  return String(f.number.int({ min: c.postcode[0], max: c.postcode[1] })).padStart(5, '0')
}

export function address(f: Faker, state: State): { line: string; city: string } {
  const c = f.helpers.arrayElement(state.cities)
  const street = `Jalan ${f.helpers.arrayElement(STREETS)} ${f.number.int({ min: 1, max: 9 })}/${f.number.int({ min: 1, max: 9 })}`
  const line = `No. ${f.number.int({ min: 1, max: 120 })}, ${street}, Taman ${f.helpers.arrayElement(TAMAN)}, ${postcodeFor(f, c)} ${c.city}, ${state.name}`
  return { line: line.toUpperCase(), city: c.city }
}

/** NRIC = YYMMDD-PB-999G. G is odd for male, even for female (matches MyKad convention). */
export function nric(dob: string, stateCode: string, gender: Gender, f: Faker): string {
  const [y, m, d] = dob.split('-')
  const g = f.helpers.arrayElement(gender === 'LELAKI' ? [1, 3, 5, 7, 9] : [0, 2, 4, 6, 8])
  return `${y.slice(2)}${m}${d}-${stateCode}-999${g}`
}

export function dobFor(f: Faker, now: Date): string {
  const age = f.number.int({ min: 18, max: 70 })
  const d = new Date(Date.UTC(now.getUTCFullYear() - age, f.number.int({ min: 0, max: 11 }), f.number.int({ min: 1, max: 28 })))
  return d.toISOString().slice(0, 10)
}

function malaysianName(f: Faker, gender: Gender): { name: string; religion?: string } {
  const male = gender === 'LELAKI'
  switch (f.helpers.weightedArrayElement([{ value: 'MALAY', weight: 6 }, { value: 'CHINESE', weight: 3 }, { value: 'INDIAN', weight: 1 }])) {
    case 'MALAY':
      return {
        name: `${f.helpers.arrayElement(male ? MALAY.male : MALAY.female)} ${male ? 'BIN' : 'BINTI'} ${f.helpers.arrayElement(MALAY.father)}`,
        religion: 'ISLAM', // MyKad prints religion for Muslims only
      }
    case 'CHINESE':
      return { name: `${f.helpers.arrayElement(CHINESE.surname)} ${f.helpers.arrayElement(male ? CHINESE.male : CHINESE.female)}` }
    default:
      return { name: `${f.helpers.arrayElement(male ? INDIAN.male : INDIAN.female)} ${male ? 'A/L' : 'A/P'} ${f.helpers.arrayElement(INDIAN.father)}` }
  }
}

export function person(f: Faker, now: Date, documentType: DocumentType = 'MYKAD'): Person {
  const gender: Gender = f.helpers.arrayElement(['LELAKI', 'PEREMPUAN'] as const)
  const dob = dobFor(f, now)
  const residence = pickState(f)
  const addr = address(f, residence)
  if (documentType === 'PASSPORT') {
    const origin = f.helpers.arrayElement(FOREIGN)
    return {
      documentType,
      city: addr.city,
      pii: {
        fullName: f.helpers.arrayElement(gender === 'LELAKI' ? origin.male : origin.female),
        passportNo: `X99${f.string.numeric(6)}`, // obviously fake prefix
        gender,
        dob,
        nationality: origin.nationality,
        address: addr.line,
      },
    }
  }
  // Mostly born in the state of residence.
  const birthState = f.number.int({ min: 1, max: 10 }) <= 8 ? residence : pickState(f)
  const { name, religion } = malaysianName(f, gender)
  return {
    documentType,
    city: addr.city,
    pii: { fullName: name, nric: nric(dob, birthState.code, gender, f), gender, dob, nationality: 'WARGANEGARA', religion, address: addr.line },
  }
}

const DEVICES = [
  { sdk: 'ekyc-android-sdk 2.9.0', os: 'Android 15', device: 'Samsung Galaxy A55' },
  { sdk: 'ekyc-android-sdk 2.9.0', os: 'Android 14', device: 'Xiaomi Redmi Note 13' },
  { sdk: 'ekyc-android-sdk 2.8.4', os: 'Android 14', device: 'Oppo Reno 11' },
  { sdk: 'ekyc-ios-sdk 2.8.3', os: 'iOS 19.1', device: 'iPhone 16' },
  { sdk: 'ekyc-ios-sdk 2.8.3', os: 'iOS 18.6', device: 'iPhone 14' },
  { sdk: 'ekyc-web-sdk 3.4.1', os: 'Windows 11', device: 'Chrome 140' },
  { sdk: 'ekyc-web-sdk 3.4.1', os: 'macOS 15', device: 'Safari 19' },
]

// RFC 5737 documentation ranges: never routable, never a real user's IP.
const DOC_IP_PREFIXES = ['192.0.2', '198.51.100', '203.0.113']

export function fakeIp(f: Faker): string {
  return `${f.helpers.arrayElement(DOC_IP_PREFIXES)}.${f.number.int({ min: 1, max: 254 })}`
}

export function clientMetadata(f: Faker, city: string): ClientMetadata {
  return { ...f.helpers.arrayElement(DEVICES), ip: fakeIp(f), geo: `${city}, MY` }
}
