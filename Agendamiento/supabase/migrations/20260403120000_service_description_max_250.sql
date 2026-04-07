-- Límite de descripción de servicio (alineado con el formulario)
alter table public.service
  add constraint service_description_max_250
  check (description is null or char_length(description) <= 250);
