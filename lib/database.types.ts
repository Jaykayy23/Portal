/**
 * Database types for the portal schema.
 *
 * Hand-written to match supabase/migrations/*.sql. Once the CLI is linked to the
 * project you can replace this file with generated output, which will stay in
 * step with the schema automatically:
 *
 *   npx supabase gen types typescript --linked > lib/database.types.ts
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface OtherKeyRow {
  name: string;
  value: string;
}

/** One selectable surge charge, as stored in pricing_params.surcharges. */
export interface SurchargeRow {
  id: string;
  label: string;
  amount: number;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          role: 'admin' | 'ops' | 'merchant';
          company_name: string;
          phone: string;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          username: string;
          role: 'admin' | 'ops' | 'merchant';
          company_name: string;
          phone?: string;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          username?: string;
          role?: 'admin' | 'ops' | 'merchant';
          company_name?: string;
          phone?: string;
          active?: boolean;
        };
        Relationships: [];
      };
      riders: {
        Row: {
          id: string;
          name: string;
          phone: string;
          reg_number: string;
          model: string;
          status: 'Available' | 'On delivery' | 'Offline';
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          phone: string;
          reg_number: string;
          model: string;
          status?: 'Available' | 'On delivery' | 'Offline';
        };
        Update: {
          name?: string;
          phone?: string;
          reg_number?: string;
          model?: string;
          status?: 'Available' | 'On delivery' | 'Offline';
        };
        Relationships: [];
      };
      deliveries: {
        Row: {
          id: string;
          created_at: string;
          merchant_id: string;
          customer: string;
          submitted_by: string;
          pickup: string;
          dropoff: string;
          distance: number;
          duration_min: number;
          type: 'Standard' | 'Express' | 'Fragile';
          item_category: string;
          surcharges: string[];
          declared_value: number;
          recommended: number;
          minimum: number;
          agreed: number;
          status: 'Requested' | 'Requires approval' | 'Approved' | 'Assigned' | 'Delivered';
          rider_id: string | null;
          rider_name: string;
          rider_phone: string;
          rider_reg: string;
          rider_model: string;
          delivered_at: string | null;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          customer: string;
          submitted_by: string;
          pickup: string;
          dropoff: string;
          distance: number;
          duration_min?: number;
          type?: 'Standard' | 'Express' | 'Fragile';
          item_category?: string;
          surcharges?: string[];
          declared_value: number;
          recommended: number;
          minimum: number;
          agreed: number;
          status?: 'Requested' | 'Requires approval' | 'Approved' | 'Assigned' | 'Delivered';
          rider_id?: string | null;
          rider_name?: string;
          rider_phone?: string;
          rider_reg?: string;
          rider_model?: string;
        };
        Update: {
          status?: 'Requested' | 'Requires approval' | 'Approved' | 'Assigned' | 'Delivered';
          rider_id?: string | null;
          rider_name?: string;
          rider_phone?: string;
          rider_reg?: string;
          rider_model?: string;
          delivered_at?: string | null;
        };
        Relationships: [];
      };
      pricing_params: {
        Row: {
          id: number;
          base: number;
          rate: number;
          per_min: number;
          min_fare: number;
          min_pct: number;
          ops_phone: string;
          surcharges: SurchargeRow[];
          updated_at: string;
        };
        Insert: {
          id?: number;
          base?: number;
          rate?: number;
          per_min?: number;
          min_fare?: number;
          min_pct?: number;
          ops_phone?: string;
          surcharges?: SurchargeRow[];
        };
        Update: {
          base?: number;
          rate?: number;
          per_min?: number;
          min_fare?: number;
          min_pct?: number;
          ops_phone?: string;
          surcharges?: SurchargeRow[];
        };
        Relationships: [];
      };
      rate_limits: {
        Row: { bucket: string; window_start: string; hits: number };
        Insert: { bucket: string; window_start?: string; hits?: number };
        Update: { window_start?: string; hits?: number };
        Relationships: [];
      };
      idempotency_keys: {
        Row: {
          id: string;
          response: Json | null;
          created_at: string;
          expires_at: string;
        };
        Insert: { id: string; response?: Json | null; expires_at: string };
        Update: { response?: Json | null };
        Relationships: [];
      };
      delivery_confirmations: {
        Row: {
          id: string;
          delivery_id: string;
          token_hash: string;
          rider_id: string | null;
          rider_name: string;
          rider_phone: string;
          issued_by: string;
          created_at: string;
          expires_at: string;
          confirmed_at: string | null;
        };
        Insert: {
          id?: string;
          delivery_id: string;
          token_hash: string;
          rider_id?: string | null;
          rider_name?: string;
          rider_phone?: string;
          issued_by: string;
          expires_at: string;
          confirmed_at?: string | null;
        };
        Update: { confirmed_at?: string | null };
        Relationships: [];
      };
      delivery_options: {
        Row: { id: number; item_categories: string[]; updated_at: string };
        Insert: { id?: number; item_categories?: string[] };
        Update: { item_categories?: string[] };
        Relationships: [];
      };
      branding: {
        Row: { id: number; logo_data_url: string; updated_at: string };
        Insert: { id?: number; logo_data_url?: string };
        Update: { logo_data_url?: string };
        Relationships: [];
      };
      app_settings: {
        Row: {
          id: number;
          maps_api_key: string;
          whatsapp_otp_key: string;
          sms_api_key: string;
          other_keys: OtherKeyRow[];
          updated_at: string;
        };
        Insert: {
          id?: number;
          maps_api_key?: string;
          whatsapp_otp_key?: string;
          sms_api_key?: string;
          other_keys?: OtherKeyRow[];
        };
        Update: {
          maps_api_key?: string;
          whatsapp_otp_key?: string;
          sms_api_key?: string;
          other_keys?: OtherKeyRow[];
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      rate_limit_hit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number };
        Returns: { allowed: boolean; retry_after_seconds: number }[];
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
