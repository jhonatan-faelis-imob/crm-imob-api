// Regras dos portais para imóveis de revenda. Fonte única: o front lê tudo daqui via GET /properties/portal-config.

export type FieldRule = 'required' | 'optional' | 'hidden'
export type AreaKind = 'living' | 'lot'

export interface PropertyTypeConfig {
  value: string
  label: string
  /** Valor do portal (VRSync). null = não publicável */
  vrsync: string | null
  /** living = área útil (areaM2); lot = área total (lotAreaM2) */
  area: AreaKind
  bedrooms: FieldRule
  bathrooms: FieldRule
  /** Andar do imóvel e andares do prédio fazem sentido */
  floors: boolean
  /** Menor número de quartos aceito quando o campo é exigido (studio aceita 0) */
  bedroomsMin: number
  /** Valor usado quando o campo fica vazio (kitnet = 0) */
  bedroomsDefault: number | null
}

function type(
  value: string,
  label: string,
  vrsync: string | null,
  area: AreaKind,
  bedrooms: FieldRule,
  bathrooms: FieldRule,
  floors = false,
  extra: Partial<Pick<PropertyTypeConfig, 'bedroomsMin' | 'bedroomsDefault'>> = {},
): PropertyTypeConfig {
  return { value, label, vrsync, area, bedrooms, bathrooms, floors, bedroomsMin: 1, bedroomsDefault: null, ...extra }
}

export const PROPERTY_TYPES: PropertyTypeConfig[] = [
  type('apartamento', 'Apartamento', 'Residential / Apartment', 'living', 'required', 'required', true),
  type('casa', 'Casa', 'Residential / Home', 'living', 'required', 'required'),
  type('casa_condominio', 'Casa em condomínio', 'Residential / Condo', 'living', 'required', 'required'),
  type('sobrado', 'Sobrado', 'Residential / Sobrado', 'living', 'required', 'required'),
  type('cobertura', 'Cobertura', 'Residential / Penthouse', 'living', 'required', 'required', true),
  type('flat', 'Flat', 'Residential / Flat', 'living', 'required', 'required', true),
  type('kitnet', 'Kitnet', 'Residential / Kitnet', 'living', 'optional', 'required', true, {
    bedroomsMin: 0,
    bedroomsDefault: 0,
  }),
  type('studio', 'Studio', 'Residential / Studio', 'living', 'required', 'optional', true, { bedroomsMin: 0 }),
  type('loft', 'Loft', 'Residential / Loft', 'living', 'required', 'required', true),
  type('terreno', 'Terreno', 'Residential / Land Lot', 'lot', 'hidden', 'hidden'),
  type('chacara', 'Chácara', 'Residential / Farm Ranch', 'lot', 'required', 'required'),
  type('fazenda_sitio', 'Fazenda / Sítio', 'Residential / Agricultural', 'lot', 'required', 'required'),
  type('sala_comercial', 'Sala comercial', 'Commercial / Office', 'living', 'hidden', 'required', true),
  type('ponto_comercial', 'Ponto comercial', 'Commercial / Business', 'living', 'hidden', 'optional'),
  type('galpao', 'Galpão', 'Commercial / Industrial', 'lot', 'hidden', 'optional'),
  type('outro', 'Outro', null, 'living', 'optional', 'optional'),
]

export const PROPERTY_TYPE_VALUES = PROPERTY_TYPES.map((item) => item.value)

export function findPropertyType(value: string | null | undefined): PropertyTypeConfig | undefined {
  return PROPERTY_TYPES.find((item) => item.value === value)
}

// O valor guardado é exatamente o aceito pelo portal (em inglês); o rótulo é o que a tela mostra
export const PROPERTY_FEATURES: { value: string; label: string }[] = [
  { value: 'Elevator', label: 'Elevador' },
  { value: 'Pool', label: 'Piscina' },
  { value: 'Private Pool', label: 'Piscina privativa' },
  { value: 'BBQ', label: 'Churrasqueira' },
  { value: 'Gourmet Area', label: 'Espaço gourmet' },
  { value: 'Party Room', label: 'Salão de festas' },
  { value: 'Playground', label: 'Playground' },
  { value: 'Gym', label: 'Academia' },
  { value: 'Sports Court', label: 'Quadra poliesportiva' },
  { value: 'Sauna', label: 'Sauna' },
  { value: 'Concierge 24h', label: 'Portaria 24h' },
  { value: 'Security Camera', label: 'Câmera de segurança' },
  { value: 'Electronic Gate', label: 'Portão eletrônico' },
  { value: 'Intercom', label: 'Interfone' },
  { value: 'Alarm System', label: 'Sistema de alarme' },
  { value: 'Balcony', label: 'Varanda' },
  { value: 'Barbecue Balcony', label: 'Churrasqueira na varanda' },
  { value: 'Gourmet Balcony', label: 'Varanda gourmet' },
  { value: 'Builtin Wardrobe', label: 'Armário embutido' },
  { value: 'Kitchen Cabinets', label: 'Armário na cozinha' },
  { value: 'Planned Furniture', label: 'Móvel planejado' },
  { value: 'Furnished', label: 'Mobiliado' },
  { value: 'Cooling', label: 'Ar condicionado' },
  { value: 'Heating', label: 'Aquecimento' },
  { value: 'Solar Energy', label: 'Energia solar' },
  { value: 'Pets Allowed', label: 'Permite animais' },
  { value: 'Closet', label: 'Closet' },
  { value: 'Laundry', label: 'Lavanderia' },
  { value: 'Backyard', label: 'Quintal' },
  { value: 'Garden Area', label: 'Jardim' },
  { value: 'Lavabo', label: 'Lavabo' },
  { value: 'American Kitchen', label: 'Cozinha americana' },
  { value: 'Home Office', label: 'Escritório' },
  { value: 'Fireplace', label: 'Lareira' },
  { value: 'Panoramic View', label: 'Vista panorâmica' },
  { value: 'Corner Property', label: 'Imóvel de esquina' },
  { value: 'Paved Street', label: 'Rua asfaltada' },
  { value: 'Fenced Yard', label: 'Condomínio fechado' },
  { value: 'Guest Parking', label: 'Estacionamento para visitante' },
  { value: 'Bicycles Place', label: 'Bicicletário' },
  { value: 'Electric Charger', label: 'Carregador elétrico' },
  { value: 'Edicule', label: 'Edícula' },
  { value: 'Pantry', label: 'Despensa' },
  { value: 'Porcelain', label: 'Porcelanato' },
  { value: 'Service Room', label: 'Quarto de serviço' },
  { value: 'Slab', label: 'Laje' },
  { value: 'Disabled Access', label: 'Acesso para deficientes' },
  { value: 'Whirlpool', label: 'Hidromassagem' },
  { value: 'Blindex Box', label: 'Box blindex' },
  { value: 'Natural Ventilation', label: 'Ventilação natural' },
  { value: 'High Ceiling Height', label: 'Pé direito alto' },
  { value: 'Cold Floor', label: 'Piso frio' },
  { value: 'Wood Floor', label: 'Piso de madeira' },
  { value: 'Laminated Floor', label: 'Piso laminado' },
  { value: 'Vinyl Floor', label: 'Piso vinílico' },
  { value: 'Walls Grids', label: 'Muro e grade' },
]

export const PROPERTY_FEATURE_VALUES = PROPERTY_FEATURES.map((item) => item.value)

export const PORTAL_LIMITS = {
  TITLE_MIN: 10,
  TITLE_MAX: 100,
  DESC_MIN: 50,
  DESC_MAX: 3000,
  PHOTOS_MIN: 5,
  FEATURES_MAX: 30,
} as const

export const IPTU_PERIODS = ['anual', 'mensal'] as const
export const PORTAL_ADDRESS_DISPLAYS = ['full', 'street', 'neighborhood'] as const

/** Qualquer tag HTML. Descrição para portal é texto puro */
export const HTML_TAG = /<[^>]*>/

/** Chamadas de IA (título e descrição) por usuário por hora. Contador em memória: vale com 1 réplica */
export const AI_DESCRIBE_LIMIT_PER_HOUR = 20

export function portalConfig() {
  return {
    types: PROPERTY_TYPES,
    features: PROPERTY_FEATURES,
    limits: PORTAL_LIMITS,
    iptuPeriods: IPTU_PERIODS,
    addressDisplays: PORTAL_ADDRESS_DISPLAYS,
  }
}
