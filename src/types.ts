import { TransactionKMS } from "@tatumio/tatum";

export declare class TransactionQtyResponseVM {
    originalKms: number;
    customKms: number;
}

export declare class AppTransactionKMS extends TransactionKMS {
    isCustom: boolean
}