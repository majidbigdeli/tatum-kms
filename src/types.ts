//@ts-nocheck
import { TransactionKMS } from "@tatumio/tatum";
import { PendingTransaction } from '@tatumio/api-client';

export declare class TransactionQtyResponseVM {
    originalKms: number;
    customKms: number;
}

export declare interface IAppTransactionKMS extends TransactionKMS{
    isCustom: boolean
    Majid(): TransactionKMS;
}
export declare class AppTransactionKMS extends TransactionKMS implements IAppTransactionKMS {
    isCustom: boolean
}