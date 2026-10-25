export type Shop = {
  id: string;
  shop_name: string;
  owner_name: string;
  address: string;
  city: string;
  pincode: string;
  lat: number | string | null; // the API sends exact decimals as text
  lng: number | string | null;
  photo_url: string | null;
};

export type Membership = { tenant_id: string; tenant_name: string; role: 'owner' | 'staff' | 'agent' };

export type Me = {
  id: string;
  phone: string;
  name: string | null;
  shop: Shop | null;
  memberships: Membership[];
  is_platform_admin?: boolean;
};

export type MyDistributor = {
  tenant_id: string;
  name: string;
  logo_url: string | null;
  brand_color: string | null;
  status: 'pending' | 'active' | 'blocked';
  joined_at: string;
  phone?: string | null; // call to confirm an order fast
};

export type CategoryNode = { id: string; name: string; image_url: string | null; children: CategoryNode[] };

export type Unit = {
  id: string;
  name: string;
  pieces_per_unit: number;
  price: number;
  price_per_piece: number;
  min_qty: number;
  step_qty: number;
  max_qty: number | null;
  is_default: boolean;
  in_stock: boolean;
};

export type CatalogCard = {
  id: string;
  name: string;
  brand: string | null;
  category_id: string;
  image: string | null;
  mrp: number | null;
  default_unit: Unit;
  in_stock: boolean;
  variant_group_id?: string | null;
  variant_label?: string | null; // '5 kg'
  variant_count?: number; // sizes to pick from (lists asked with group_variants)
};

export type CatalogDetail = {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  category_path: string[];
  mrp: number | null;
  images: string[];
  thumbnails: string[];
  features: { key: string; label: string; value: string | number | boolean; unit: string | null }[];
  units: Unit[];
  in_stock: boolean;
  variant_label?: string | null;
  variants?: CatalogCard[]; // every size incl. this one; empty when there are no others
};

export type CartLine = {
  id: string;
  product_id: string;
  unit_id: string;
  product_name: string;
  brand: string | null;
  image: string | null;
  unit_name: string;
  pieces_per_unit: number;
  price: number;
  mrp?: number | null;
  qty: number;
  line_total: number;
  min_qty: number;
  step_qty: number;
  max_qty: number | null;
  problem: string | null;
};

export type Cart = { items: CartLine[]; item_count: number; total: number; note: string | null; can_place_order: boolean };

export type OrderStatus = 'pending' | 'approved' | 'dispatched' | 'delivered' | 'rejected' | 'cancelled';

export type OrderSummary = {
  id: string;
  tenant_id: string;
  distributor_name: string;
  order_no: number;
  shop_id: string | null; // null for counter sales
  shop_name: string;
  status: OrderStatus;
  source: 'shop' | 'agent' | 'admin' | 'counter';
  payment_status?: 'unpaid' | 'partial' | 'paid';
  placed_by_name: string | null;
  item_count: number;
  items_total: number;
  created_at: string;
};

export type OrderItem = {
  id: string;
  product_name: string;
  unit_name: string;
  pieces_per_unit: number;
  rate: number;
  qty_ordered: number;
  qty_approved: number | null;
  qty_dispatched: number | null;
  qty: number;
  line_total: number;
};

export type OrderEvent = { from_status: string | null; to_status: OrderStatus; by_name: string | null; note: string | null; at: string };

export type Order = OrderSummary & {
  note: string | null;
  shop_address: string;
  shop_lat: number | null;
  shop_lng: number | null;
  shop_phone: string | null;
  items: OrderItem[];
  events: OrderEvent[];
};

export type Page<T> = { items: T[]; total: number };

export type AgentShop = {
  shop_id: string;
  shop_name: string;
  owner_name: string;
  owner_phone: string;
  address: string;
  city: string;
  pincode: string;
  status: 'pending' | 'active' | 'blocked';
  agent_name: string | null;
  added_by_agent: boolean;
  last_order_at: string | null;
};

// ---------- distributor (manage) ----------

export type TenantInfo = {
  id: string;
  name: string;
  logo_url: string | null;
  brand_color: string | null;
  my_role: 'owner' | 'staff' | 'agent' | 'shop';
  join_code: string | null;
  agent_shops_auto_approve: boolean | null;
  agents_see_all_shops: boolean | null;
  contact_phone?: string | null; // number shops call (own setting, else the owner's phone)
  contact_phone_custom?: string | null; // owner/staff only: the setting itself
};

export type Dashboard = {
  pending_orders: number;
  to_dispatch: number;
  shops_waiting: number;
  low_stock: number;
  out_of_stock: number;
  today_orders: number;
  today_value: number;
};

export type ManageUnit = {
  id: string;
  name: string;
  pieces_per_unit: number;
  price: number;
  price_per_piece: number;
  min_qty: number;
  step_qty: number;
  max_qty: number | null;
  is_default: boolean;
  sort_order: number;
};

export type ManageProduct = {
  id: string;
  category_id: string;
  name: string;
  brand: string | null;
  description: string | null;
  search_aliases: string | null;
  sku: string | null;
  mrp: number | null;
  attributes: Record<string, string | number | boolean>;
  images: string[];
  thumbnails: string[];
  status: 'active' | 'hidden';
  units: ManageUnit[];
  stock_pieces: number;
  variant_group_id?: string | null;
  variant_label?: string | null;
  sizes?: SizeInfo[]; // other sizes in the group
};

export type SizeInfo = { id: string; label: string; name: string; status: 'active' | 'hidden'; price: number | null; stock_pieces: number };

export type Attribute = {
  id: string;
  category_id: string;
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  unit: string | null;
  options: string[];
  required: boolean;
  is_filter: boolean;
  inherited?: boolean;
};

export type FlatCategory = {
  id: string;
  parent_id: string | null;
  name: string;
  attributes: Attribute[];
  image_url?: string | null;
  sort_order?: number;
  product_count?: number;
};

export type TenantShop = AgentShop & { agent_user_id: string | null; joined_at: string; lat: number | null; lng: number | null };

export type Member = { user_id: string; phone: string; name: string | null; role: 'owner' | 'staff' | 'agent'; assigned_shops: number };

export type LedgerEntry = {
  id: string;
  change_pieces: number;
  balance_after: number;
  reason: string;
  note: string | null;
  created_at: string;
};

export type RelatedLink = {
  product_id: string;
  name: string;
  brand: string | null;
  image: string | null;
  status: 'active' | 'hidden';
  score: number;
  bought_together: number;
  pinned: boolean;
};

export type Report = {
  days: number;
  start: string;
  end: string;
  orders: number;
  value: number;
  average_order: number;
  shops_ordering: number;
  new_shops: number;
  status_counts: Partial<Record<OrderStatus, number>>;
  by_source: Partial<Record<OrderSource, number>>;
  by_day: ReportDay[];
  top_products: ReportProduct[];
  top_shops: ReportShop[];
  top_agents: { user_id: string; name: string; orders: number; value: number }[];
  // newer fields (older servers leave them out)
  prev_orders?: number;
  prev_value?: number;
  channels?: { source: OrderSource; orders: number; value: number }[];
  payments?: { paid_value: number; unpaid_value: number; unpaid_orders: number } | null;
  top_categories?: { category_id: string | null; name: string; value: number; pieces: number }[];
  by_hour?: { hour: number; orders: number }[];
  agents?: AgentStat[];
  quiet_shops?: { shop_id: string; name: string; city: string; last_order_at: string; agent_name: string | null }[];
  quiet_shops_total?: number;
};

export type OrderSource = 'shop' | 'agent' | 'admin' | 'counter';
export type ReportDay = { date: string; orders: number; value: number };
export type ReportProduct = { product_id: string | null; name: string; pieces: number; value: number; orders: number };
export type ReportShop = { shop_id: string; name: string; orders: number; value: number };

export type AgentStat = {
  user_id: string;
  name: string;
  phone: string;
  orders: number;
  value: number;
  average_order: number;
  shops_ordered: number;
  assigned_shops: number;
  shops_signed_up: number;
  last_order_at: string | null;
  share: number;
};

export type AgentReport = {
  days: number;
  start: string;
  end: string;
  agent: AgentStat;
  by_day: ReportDay[];
  top_shops: ReportShop[];
  top_products: ReportProduct[];
  idle_shops: { shop_id: string; name: string; city: string; last_order_at: string | null }[];
};

export type Banner = {
  id: string;
  title: string | null;
  subtitle: string | null;
  image_url: string | null;
  color: string | null;
  link_category_id: string | null;
  is_active: boolean;
  sort_order: number;
};

export type AdminTenant = {
  id: string;
  name: string;
  join_code: string;
  status: 'active' | 'suspended';
  owner_phone: string | null;
  owner_name: string | null;
  shops: number;
  products: number;
  orders: number;
  created_at: string;
};
