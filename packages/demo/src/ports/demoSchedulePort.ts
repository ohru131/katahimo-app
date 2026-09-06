import type {
  LatLng,
  MapsPort,
  ScheduleAppointmentLight,
  ScheduleAppointmentWithRoute,
  ScheduleLightResult,
  SchedulePort,
  ScheduleWithRouteResult,
} from '@katahimo/core/ports';
import { DEMO_FIGURES, DEMO_OFFICE } from '../seed/figures';
import { planVisitsForDate } from '../seed/visitPlan';

const CUSTOMER_EVENT_TYPE = 'CUSTOMER APPOINTMENT';

/** 顧客名から顧客IDを引くための、シード時に作った対応表。 */
export type CustomerIdByName = ReadonlyMap<string, string>;

function fullAddress(index: number): string {
  const figure = DEMO_FIGURES[index];
  if (!figure) throw new Error(`存在しないデモ世帯です: index=${index}`);
  return `${figure.prefecture}${figure.city}${figure.addressDetail}`;
}

function figureName(index: number): string {
  const figure = DEMO_FIGURES[index];
  if (!figure) throw new Error(`存在しないデモ世帯です: index=${index}`);
  return `${figure.familyName} ${figure.givenName}`;
}

function figureLatLng(index: number): LatLng {
  const figure = DEMO_FIGURES[index];
  if (!figure) throw new Error(`存在しないデモ世帯です: index=${index}`);
  return { lat: figure.lat, lng: figure.lng };
}

/**
 * SchedulePortのデモ実装。
 *
 * 本番はGoogleカレンダーの予定をGAS Bridge経由で解析して返すが、デモにはカレンダーが無い。
 * planVisitsForDate()で日付から予定を導出するため、いつアクセスしても「今日」「明日」の
 * 予定が入っている状態になる(過去の訪問履歴も同じ関数から作られており、両者は一致する)。
 */
export class DemoSchedulePort implements SchedulePort {
  constructor(
    private readonly maps: MapsPort,
    private readonly customerIdByName: CustomerIdByName,
  ) {}

  async getSchedule(staffName: string, dateString: string): Promise<ScheduleLightResult> {
    const visits = planVisitsForDate(dateString, staffName, DEMO_FIGURES.length);
    const appointments: ScheduleAppointmentLight[] = visits.map((visit) => ({
      title: figureName(visit.figureIndex),
      eventType: CUSTOMER_EVENT_TYPE,
      start: visit.start,
      end: visit.end,
      address: fullAddress(visit.figureIndex),
    }));
    return { success: true, date: dateString, staffName, appointments };
  }

  async getScheduleWithRoute(staffName: string, dateString: string): Promise<ScheduleWithRouteResult> {
    const visits = planVisitsForDate(dateString, staffName, DEMO_FIGURES.length);
    const office: LatLng = { lat: DEMO_OFFICE.lat, lng: DEMO_OFFICE.lng };

    const appointments: ScheduleAppointmentWithRoute[] = [];
    for (const [i, visit] of visits.entries()) {
      const destination = figureLatLng(visit.figureIndex);
      const previous = i === 0 ? null : figureLatLng(visits[i - 1]?.figureIndex ?? 0);
      const isLast = i === visits.length - 1;

      // 出勤=事業所から初回訪問先まで。移動=前の訪問先から。退勤=最終訪問先から事業所へ。
      const attendanceLeg = i === 0 ? await this.maps.route(office, destination) : null;
      const moveLeg = previous ? await this.maps.route(previous, destination) : null;
      const leavingLeg = isLast ? await this.maps.route(destination, office) : null;

      const name = figureName(visit.figureIndex);
      appointments.push({
        eventType: CUSTOMER_EVENT_TYPE,
        customerName: name,
        startTime: visit.start,
        endTime: visit.end,
        // 予約システム(RESERVA)への深いリンクはデモでは持たない。
        reservaUrl: '',
        moveUrl: mapsUrl(previous, destination),
        moveMin: moveLeg?.durationMin ?? '',
        moveKm: moveLeg?.distanceKm ?? '',
        attendanceUrl: i === 0 ? mapsUrl(office, destination) : '',
        attendanceMin: attendanceLeg?.durationMin ?? '',
        attendanceKm: attendanceLeg?.distanceKm ?? '',
        leavingUrl: isLast ? mapsUrl(destination, office) : '',
        leavingMin: leavingLeg?.durationMin ?? '',
        leavingKm: leavingLeg?.distanceKm ?? '',
        customerId: this.customerIdByName.get(name) ?? '',
        address: fullAddress(visit.figureIndex),
      });
    }

    return { success: true, date: dateString, staffName, appointments };
  }
}

/** 経路リンクだけは本物のGoogleマップに飛ばす(APIキー不要のURLスキーム)。 */
function mapsUrl(origin: LatLng | null, destination: LatLng): string {
  if (!origin) return '';
  const from = `${origin.lat},${origin.lng}`;
  const to = `${destination.lat},${destination.lng}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${from}&destination=${to}&travelmode=driving`;
}
