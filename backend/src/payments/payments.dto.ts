import {
  IsInt,
  Min,
  IsString,
  IsNotEmpty,
  Length,
  Matches,
  IsOptional,
} from 'class-validator';

export class CreatePaymentRequestDto {
  @IsInt({ message: 'Amount must be an integer' })
  @Min(100, { message: 'Amount must be at least ₹100' })
  amount: number;

  @IsString({ message: 'UTR number must be a string' })
  @IsNotEmpty({ message: 'UTR number cannot be empty' })
  @Length(8, 25, { message: 'UTR length must be between 8 and 25 characters' })
  @Matches(/^[a-zA-Z0-9]+$/, {
    message: 'UTR must contain only alphanumeric characters',
  })
  utr_number: string;
}

export class RejectPaymentDto {
  @IsOptional()
  @IsString({ message: 'Admin note must be a string' })
  @Length(0, 500, { message: 'Admin note cannot exceed 500 characters' })
  admin_note?: string;
}

export interface PaymentRequestRecord {
  id: string;
  client_id: string;
  amount: number;
  minutes_requested: number;
  utr_number: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_note: string | null;
  created_at: string;
  resolved_at: string | null;
  client_email?: string | null;
  client_business_name?: string | null;
}

export interface ClientPaymentResponse {
  id: string;
  amount: number;
  minutes_requested: number;
  utr_number: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  admin_note: string | null;
}

export interface CreatePaymentResponse {
  message: string;
  minutes_requested: number;
}

export interface ClientBalanceResponse {
  balance: number;
  label: 'minutes';
}

export interface ApprovePaymentResponse {
  message: string;
  minutes_added: number;
}

export interface RejectPaymentResponse {
  message: string;
}

export interface AdminStatsResponse {
  pending_payment_count: number;
  total_payment_count: number;
  approved_payment_count: number;
  rejected_payment_count: number;
  total_approved_amount: number;
  total_approved_minutes: number;
}
