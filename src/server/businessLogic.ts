import crypto from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  auditLogs,
  bookings,
  bookingStatusHistory,
  commissions,
  countries,
  countryDeployments,
  missions,
  payments,
  paymentTransactions,
  refunds,
} from '../db/schema.ts';

// Allowed state transitions for Bookings (strictly enforced server-side)
const ALLOWED_BOOKING_TRANSITIONS: Record<string, string[]> = {
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['AWAITING_CLIENT_VALIDATION', 'DISPUTED', 'CANCELLED'],
  AWAITING_CLIENT_VALIDATION: ['COMPLETED', 'DISPUTED'],
  COMPLETED: ['DISPUTED'],
  DISPUTED: ['COMPLETED', 'CANCELLED'],
  CANCELLED: [],
};

export function canTransitionBooking(fromStatus: string, toStatus: string): boolean {
  const allowed = ALLOWED_BOOKING_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
}

export function canActorTransitionBooking(params: {
  toStatus: string;
  isClientOwner: boolean;
  isAssignedPro: boolean;
  isCountryAdmin: boolean;
}): { allowed: boolean; reason?: string } {
  const { toStatus, isClientOwner, isAssignedPro, isCountryAdmin } = params;
  if (!isClientOwner && !isAssignedPro && !isCountryAdmin) {
    return { allowed: false, reason: 'Access denied for this booking' };
  }
  if (toStatus === 'IN_PROGRESS' || toStatus === 'AWAITING_CLIENT_VALIDATION') {
    if (!isAssignedPro && !isCountryAdmin) {
      return { allowed: false, reason: 'Only the assigned professional or authorized admin can advance execution' };
    }
  }
  if (toStatus === 'COMPLETED') {
    if (!isClientOwner && !isCountryAdmin) {
      return { allowed: false, reason: 'Only the client or authorized admin can validate final completion' };
    }
  }
  return { allowed: true };
}

export async function transitionBookingStatus(params: {
  bookingId: string;
  toStatus: string;
  actorUid: string;
  actorRole: string;
  note?: string;
}) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, params.bookingId))
      .limit(1);

    const booking = rows[0];
    if (!booking) {
      throw new Error('Booking not found');
    }

    if (!canTransitionBooking(booking.status, params.toStatus)) {
      throw new Error(`Invalid booking transition from ${booking.status} to ${params.toStatus}`);
    }

    const updatePayload: Partial<typeof bookings.$inferInsert> = {
      status: params.toStatus,
      updatedAt: new Date(),
    };

    if (params.toStatus === 'COMPLETED') {
      updatePayload.clientValidatedAt = new Date();
    }

    const [updated] = await tx
      .update(bookings)
      .set(updatePayload)
      .where(and(eq(bookings.id, booking.id), eq(bookings.status, booking.status)))
      .returning();

    if (!updated) {
      throw new Error('Concurrent booking state modification detected');
    }

    await tx.insert(bookingStatusHistory).values({
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus: params.toStatus,
      actorUid: params.actorUid,
      note: params.note || null,
    });

    const missionStatusMap: Record<string, string> = {
      IN_PROGRESS: 'IN_PROGRESS',
      AWAITING_CLIENT_VALIDATION: 'PENDING_VALIDATION',
      COMPLETED: 'COMPLETED',
      DISPUTED: 'DISPUTED',
      CANCELLED: 'CANCELLED',
    };
    if (missionStatusMap[params.toStatus]) {
      await tx
        .update(missions)
        .set({ status: missionStatusMap[params.toStatus], updatedAt: new Date() })
        .where(eq(missions.id, booking.missionId));
    }

    await tx.insert(auditLogs).values({
      actorUid: params.actorUid,
      actorRole: params.actorRole,
      action: 'BOOKING_STATUS_CHANGED',
      entityType: 'booking',
      entityId: booking.id,
      details: { fromStatus: booking.status, toStatus: params.toStatus },
    });

    return updated;
  });
}

export interface ActivationCheckResult {
  canActivate: boolean;
  missingCriteria: string[];
}

export function evaluateCountryActivationReadiness(dep: typeof countryDeployments.$inferSelect): ActivationCheckResult {
  const missing: string[] = [];
  if (!dep.configComplete) missing.push('configComplete');
  if (!dep.complianceVerified) missing.push('complianceVerified');
  if (!dep.paymentsConfigured) missing.push('paymentsConfigured');
  if (!dep.localLeadAssigned) missing.push('localLeadAssigned');
  if (!dep.securityTestsPassed) missing.push('securityTestsPassed');
  if (!dep.functionalTestsPassed) missing.push('functionalTestsPassed');
  if (!dep.activationAuthorized) missing.push('activationAuthorized');
  return {
    canActivate: missing.length === 0,
    missingCriteria: missing,
  };
}

export function evaluateCountryActivationIntegrity(params: {
  country: typeof countries.$inferSelect;
  deployment: typeof countryDeployments.$inferSelect;
  citiesCount: number;
  configuredProvidersCount: number;
}): ActivationCheckResult {
  const base = evaluateCountryActivationReadiness(params.deployment);
  const missing = [...base.missingCriteria];

  const rate = Number(params.country.commissionRatePct);
  if (
    !params.country.iso2 ||
    !params.country.iso3 ||
    !params.country.defaultCurrency ||
    !params.country.timezone ||
    !params.country.callingCode ||
    Number.isNaN(rate) ||
    rate < 8 ||
    rate > 12 ||
    params.citiesCount < 1
  ) {
    if (!missing.includes('countryMetadataValid')) missing.push('countryMetadataValid');
  }

  if (params.configuredProvidersCount < 1 && !missing.includes('paymentProviderConfigured')) {
    missing.push('paymentProviderConfigured');
  }

  return {
    canActivate: missing.length === 0,
    missingCriteria: missing,
  };
}

export function calculateCommissionSplit(grossAmount: number, ratePct: number) {
  const clampedRate = Math.min(Math.max(ratePct, 8), 12);
  const commission = Math.round(grossAmount * (clampedRate / 100) * 100) / 100;
  const net = Math.round((grossAmount - commission) * 100) / 100;
  return {
    ratePct: clampedRate.toFixed(2),
    commissionAmount: commission.toFixed(2),
    netToProfessional: net.toFixed(2),
  };
}

export function signWebhookPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = signWebhookPayload(payload, secret);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function confirmPaymentServerSide(params: {
  paymentId: string;
  externalRef: string;
  signatureVerified: boolean;
  rawPayload: Record<string, unknown>;
  reportedAmount?: number;
  reportedCurrency?: string;
}) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, params.paymentId))
      .limit(1);
    const payment = rows[0];
    if (!payment) throw new Error('Payment not found');

    if (
      params.reportedAmount !== undefined &&
      Math.abs(Number(params.reportedAmount) - Number(payment.amountGross)) > 0.01
    ) {
      throw new Error('Payment amount mismatch against server booking total');
    }

    if (
      params.reportedCurrency !== undefined &&
      String(params.reportedCurrency).toUpperCase() !== payment.currency.toUpperCase()
    ) {
      throw new Error('Payment currency mismatch against server booking currency');
    }

    if (payment.status === 'CONFIRMED_SERVER') {
      return payment; // Idempotent return
    }

    if (payment.status === 'REFUNDED' || payment.status === 'FAILED') {
      throw new Error(`Cannot confirm payment in terminal state ${payment.status}`);
    }

    const [countryRow] = await tx
      .select()
      .from(countries)
      .where(eq(countries.id, payment.countryId))
      .limit(1);

    const ratePct = Number(countryRow?.commissionRatePct ?? '10.00');
    const split = calculateCommissionSplit(Number(payment.amountGross), ratePct);

    const [updated] = await tx
      .update(payments)
      .set({
        status: 'CONFIRMED_SERVER',
        commissionAmount: split.commissionAmount,
        netToProfessional: split.netToProfessional,
        externalRef: params.externalRef,
        confirmedAt: new Date(),
      })
      .where(and(eq(payments.id, payment.id), inArray(payments.status, ['INITIATED', 'PENDING_CONFIRMATION'])))
      .returning();

    if (!updated) {
      const [latest] = await tx.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
      if (latest?.status === 'CONFIRMED_SERVER') return latest;
      throw new Error(`Cannot confirm payment in state ${latest?.status || 'UNKNOWN'}`);
    }

    await tx
      .insert(commissions)
      .values({
        paymentId: payment.id,
        countryId: payment.countryId,
        ratePct: split.ratePct,
        amount: split.commissionAmount,
        currency: payment.currency,
      })
      .onConflictDoNothing();

    await tx.insert(paymentTransactions).values({
      paymentId: payment.id,
      eventType: 'SERVER_RECONCILED',
      payload: params.rawPayload,
      signatureVerified: params.signatureVerified,
    });

    return updated;
  });
}

export async function failPaymentServerSide(params: {
  paymentId: string;
  reason: string;
  signatureVerified: boolean;
  rawPayload: Record<string, unknown>;
}) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, params.paymentId))
      .limit(1);
    const payment = rows[0];
    if (!payment) throw new Error('Payment not found');
    if (payment.status === 'FAILED') {
      return payment;
    }
    if (payment.status === 'CONFIRMED_SERVER' || payment.status === 'REFUNDED') {
      throw new Error(`Cannot mark payment FAILED in terminal state ${payment.status}`);
    }

    const [updated] = await tx
      .update(payments)
      .set({ status: 'FAILED' })
      .where(and(eq(payments.id, payment.id), inArray(payments.status, ['INITIATED', 'PENDING_CONFIRMATION'])))
      .returning();

    if (!updated) {
      const [latest] = await tx.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
      return latest || payment;
    }

    await tx.insert(paymentTransactions).values({
      paymentId: payment.id,
      eventType: 'PAYMENT_FAILED',
      payload: { ...params.rawPayload, reason: params.reason },
      signatureVerified: params.signatureVerified,
    });

    return updated;
  });
}

export async function issueRefundServerSide(params: {
  paymentId: string;
  reason: string;
  actorUid: string;
  actorRole: string;
}) {
  return db.transaction(async (tx) => {
    const [updatedPayment] = await tx
      .update(payments)
      .set({ status: 'REFUNDED' })
      .where(and(eq(payments.id, params.paymentId), eq(payments.status, 'CONFIRMED_SERVER')))
      .returning();

    if (!updatedPayment) {
      const [existing] = await tx
        .select({ id: payments.id, status: payments.status })
        .from(payments)
        .where(eq(payments.id, params.paymentId))
        .limit(1);
      if (!existing) throw new Error('Payment not found');
      throw new Error('Only server-confirmed payments can be refunded');
    }

    const [countryRow] = await tx
      .select()
      .from(countries)
      .where(eq(countries.id, updatedPayment.countryId))
      .limit(1);

    const [refundRow] = await tx
      .insert(refunds)
      .values({
        paymentId: updatedPayment.id,
        amount: updatedPayment.amountGross,
        currency: updatedPayment.currency,
        reason: params.reason,
        status: 'APPROVED',
        processedByUid: params.actorUid,
      })
      .returning();

    await tx.insert(paymentTransactions).values({
      paymentId: updatedPayment.id,
      eventType: 'REFUND_ISSUED',
      payload: { refundId: refundRow.id, reason: params.reason },
      signatureVerified: true,
    });

    await tx.insert(auditLogs).values({
      actorUid: params.actorUid,
      actorRole: params.actorRole,
      countryIso2: countryRow?.iso2 || null,
      action: 'PAYMENT_REFUNDED',
      entityType: 'payment',
      entityId: updatedPayment.id,
      details: { amount: updatedPayment.amountGross, currency: updatedPayment.currency, reason: params.reason },
    });

    return refundRow;
  });
}
