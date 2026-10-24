export type Shop = {
  id: string;
  shop_name: string;
  owner_name: string;
  address: string;
  city: string;
  pincode: string;
  lat: number | null;
  lng: number | null;
  photo_url: string | null;
};

export type Membership = { tenant_id: string; tenant_name: string; role: 'owner' | 'staff' | 'agent' };

export type Me = { id: string; phone: string; name: string | null; shop: Shop | null; memberships: Membership[] };

export type MyDistributor = {
  tenant_id: string;
  name: string;
  logo_url: string | null;
  brand_color: string | null;
  status: 'pending' | 'active' | 'blocked';
  joined_at: string;
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
  shop_id: string;
  shop_name: string;
  status: OrderStatus;
  source: 'shop' | 'agent' | 'admin';
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
