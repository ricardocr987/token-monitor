import BN from 'bn.js';

export function hexToBN(hex: string): BN {
    hex = hex.replace('0x', '');
    return new BN(hex, 'hex');
}

export function bnToHex(bn: BN): string {
    if (bn.isNeg()) {
        return '-' + bn.abs().toString('hex', 64);
    }
    return bn.toString('hex', 64);
}

export function bnDiv(num: BN, decimals: number): number {
    const den = new BN(10).pow(new BN(decimals));
    const { div, mod: rem } = num.divmod(den);
    const quotient = div.toNumber();

    let remN;
    while (remN === undefined && decimals > 0) {
        try {
            remN = rem.toNumber();
        } catch {
            rem.idivn(10);
            decimals--;
        }
    }

    remN = remN || 0;
    for (let i = 0; i < decimals; i++) {
        remN = remN / 10;
    }
    return quotient + remN;
}

export function round(num: number, decimals = 2): number {
    const pow = 10 ** decimals;
    return Math.round((num + Number.EPSILON) * pow) / pow;
}