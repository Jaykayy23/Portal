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
          role: 'admin' | 'ops' | 'merchant' | 'finance';
          company_name: string;
          phone: string;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          username: string;
          role: 'admin' | 'ops' | 'merchant' | 'finance';
          company_name: string;
          phone?: string;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          username?: string;
          role?: 'admin' | 'ops' | 'merchant' | 'finance';
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
          recipient_name: string;
          recipient_phone: string;
          submitted_by: string;
          pickup: string;
          dropoff: string;
          distance: number;
          duration_min: number;
          type: 'Standard' | 'Express' | 'Fragile';
          item_category: string;
          surcharges: string[];
          declared_value: number;
          item_payment: '' | 'Prepaid' | 'Cash on delivery';
          delivery_paid_by: '' | 'Merchant' | 'Customer';
          recommended: number;
          minimum: number;
          agreed: number;
          status: 'Requested' | 'Approved' | 'Pending' | 'Declined' | 'Assigned' | 'Picked up' | 'Recipient confirmed' | 'Delivered';
          rider_id: string | null;
          rider_name: string;
          rider_phone: string;
          rider_reg: string;
          rider_model: string;
          accepted_at: string | null;
          declined_at: string | null;
          picked_up_at: string | null;
          recipient_confirmed_at: string | null;
          delivered_at: string | null;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          customer: string;
          recipient_name?: string;
          recipient_phone?: string;
          submitted_by: string;
          pickup: string;
          dropoff: string;
          distance: number;
          duration_min?: number;
          type?: 'Standard' | 'Express' | 'Fragile';
          item_category?: string;
          surcharges?: string[];
          declared_value: number;
          item_payment?: '' | 'Prepaid' | 'Cash on delivery';
          delivery_paid_by?: '' | 'Merchant' | 'Customer';
          recommended: number;
          minimum?: number;
          agreed: number;
          status?: 'Requested' | 'Approved' | 'Pending' | 'Declined' | 'Assigned' | 'Picked up' | 'Recipient confirmed' | 'Delivered';
          rider_id?: string | null;
          rider_name?: string;
          rider_phone?: string;
          rider_reg?: string;
          rider_model?: string;
        };
        Update: {
          status?: 'Requested' | 'Approved' | 'Pending' | 'Declined' | 'Assigned' | 'Picked up' | 'Recipient confirmed' | 'Delivered';
          rider_id?: string | null;
          rider_name?: string;
          rider_phone?: string;
          rider_reg?: string;
          rider_model?: string;
          accepted_at?: string | null;
          declined_at?: string | null;
          picked_up_at?: string | null;
          recipient_confirmed_at?: string | null;
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
          ops_phone?: string;
          surcharges?: SurchargeRow[];
        };
        Update: {
          base?: number;
          rate?: number;
          per_min?: number;
          min_fare?: number;
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
      delivery_links: {
        Row: {
          id: string;
          delivery_id: string;
          token_hash: string;
          purpose: 'rider-response' | 'recipient-confirm' | 'rider-complete';
          outcome: 'accepted' | 'declined' | 'confirmed' | null;
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
          purpose: 'rider-response' | 'recipient-confirm' | 'rider-complete';
          outcome?: 'accepted' | 'declined' | 'confirmed' | null;
          rider_id?: string | null;
          rider_name?: string;
          rider_phone?: string;
          issued_by: string;
          expires_at: string;
          confirmed_at?: string | null;
        };
        Update: {
          outcome?: 'accepted' | 'declined' | 'confirmed' | null;
          confirmed_at?: string | null;
        };
        Relationships: [];
      };
      delivery_options: {
        Row: { id: number; item_categories: string[]; updated_at: string };
        Insert: { id?: number; item_categories?: string[] };
        Update: { item_categories?: string[] };
        Relationships: [];
      };
      settlements: {
        Row: {
          id: string;
          created_at: string;
          settled_at: string;
          rider_id: string | null;
          rider_name: string;
          merchant_id: string | null;
          method: '' | 'Cash' | 'Mobile money' | 'Bank transfer' | 'Cheque' | 'Offset';
          reference: string;
          note: string;
          recorded_by: string;
          recorded_by_name: string;
          voided_at: string | null;
          voided_by: string | null;
          voided_by_name: string;
          void_reason: string;
        };
        // Written only by public.record_settlement() / public.void_settlement(),
        // which run as owner. `authenticated` holds no INSERT or UPDATE grant on
        // this table, so these two exist for the service-role client alone.
        Insert: {
          id?: string;
          settled_at?: string;
          rider_id?: string | null;
          rider_name?: string;
          merchant_id?: string | null;
          method?: '' | 'Cash' | 'Mobile money' | 'Bank transfer' | 'Cheque' | 'Offset';
          reference?: string;
          note?: string;
          recorded_by: string;
          recorded_by_name?: string;
        };
        Update: {
          voided_at?: string | null;
          voided_by?: string | null;
          voided_by_name?: string;
          void_reason?: string;
        };
        Relationships: [];
      };
      settlement_lines: {
        Row: {
          id: string;
          settlement_id: string;
          delivery_id: string;
          stream: 'goods' | 'fee';
          leg: 'in' | 'out';
          kind: 'payment' | 'writeoff';
          /** Part or all of the obligation. A trigger bounds it to what is owed. */
          amount: number;
          settled_at: string;
          voided: boolean;
        };
        Insert: {
          id?: string;
          settlement_id: string;
          delivery_id: string;
          stream: 'goods' | 'fee';
          leg: 'in' | 'out';
          kind?: 'payment' | 'writeoff';
          amount: number;
          settled_at: string;
          voided?: boolean;
        };
        Update: { voided?: boolean };
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
      // An omitted amount means all of what is still owed, and kind defaults to
      // payment. Whatever is sent is bounded server-side by the room the
      // obligation has left — see the partial-settlements migration.
      record_settlement: {
        Args: {
          p_rider_id: string | null;
          p_merchant_id: string | null;
          p_method: string;
          p_reference: string;
          p_note: string;
          p_settled_at: string | null;
          p_lines: {
            delivery_id: string;
            stream: 'goods' | 'fee';
            leg: 'in' | 'out';
            kind?: 'payment' | 'writeoff';
            amount?: number;
          }[];
        };
        /** The new settlement's id. */
        Returns: string;
      };
      void_settlement: {
        Args: { p_id: string; p_reason: string };
        Returns: undefined;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
