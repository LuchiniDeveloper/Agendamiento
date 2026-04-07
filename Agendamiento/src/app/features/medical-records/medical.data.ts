import { inject, Injectable } from '@angular/core';
import { SUPABASE_CLIENT } from '../../core/supabase';

export interface MedicalAppointmentEmbed {
  start_date_time: string;
  end_date_time?: string | null;
  vet?: { id: string; name: string } | null;
  service?: { id: string; name: string } | null;
}

export interface MedicalRecordRow {
  id: string;
  pet_id: string;
  appointment_id: string | null;
  diagnosis: string | null;
  treatment: string | null;
  observations: string | null;
  weight: number | null;
  next_visit_date: string | null;
  created_at: string;
  appointment?: MedicalAppointmentEmbed | null;
}

@Injectable({ providedIn: 'root' })
export class MedicalData {
  private readonly supabase = inject(SUPABASE_CLIENT);

  /** Última nota clínica vinculada a esta cita (si existe). */
  getByAppointmentId(appointmentId: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase
      .from('medical_record')
      .select('*')
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
  }

  listByPet(
    petId: string,
    opts?: {
      createdFromIso?: string;
      createdToIso?: string;
      limit?: number;
    },
  ) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    let q = this.supabase
      .from('medical_record')
      .select(
        `*,
        appointment:appointment_id (
          start_date_time,
          end_date_time,
          vet:user_id (id, name),
          service:service_id (id, name)
        )`,
      )
      .eq('pet_id', petId)
      .order('created_at', { ascending: false });
    if (opts?.createdFromIso) q = q.gte('created_at', opts.createdFromIso);
    if (opts?.createdToIso) q = q.lte('created_at', opts.createdToIso);
    if (opts?.limit != null) q = q.limit(opts.limit);
    return q;
  }

  insert(row: {
    pet_id: string;
    appointment_id?: string | null;
    diagnosis?: string | null;
    treatment?: string | null;
    observations?: string | null;
    weight?: number | null;
    next_visit_date?: string | null;
  }) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('medical_record').insert(row).select('id').single();
  }

  update(
    id: string,
    row: {
      diagnosis?: string | null;
      treatment?: string | null;
      observations?: string | null;
      weight?: number | null;
      next_visit_date?: string | null;
    },
  ) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('medical_record').update(row).eq('id', id);
  }

  delete(id: string) {
    if (!this.supabase) throw new Error('Supabase no configurado');
    return this.supabase.from('medical_record').delete().eq('id', id);
  }
}
