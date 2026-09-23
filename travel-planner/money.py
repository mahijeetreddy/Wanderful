"""Exact amounts in a single explicitly supported trip currency. Never performs FX."""
from decimal import Decimal, InvalidOperation

_TWO = "USD EUR GBP INR CAD AUD CHF CNY SGD AED NZD MXN BRL IDR ZAR THB MYR PHP TRY NOK SEK DKK PLN CZK HUF ILS SAR QAR EGP PEN COP ARS TWD HKD"
EXPONENTS = {**{code: 2 for code in _TWO.split()}, **{code: 0 for code in "JPY KRW VND CLP ISK".split()}, **{code: 3 for code in "KWD BHD OMR JOD TND".split()}}


def exponent(currency):
    if not isinstance(currency, str) or currency not in EXPONENTS:
        raise ValueError("Unsupported currency precision. Choose a supported trip currency; no conversion is performed.")
    return EXPONENTS[currency]


def minor(value, currency):
    if value is None or isinstance(value, bool):
        raise ValueError("A monetary amount is required.")
    try:
        amount = Decimal(str(value)) * 10 ** exponent(currency)
        if not amount.is_finite() or amount < 0 or amount > 9_000_000_000_000 or amount != amount.to_integral_value():
            raise ValueError("Amount must be nonnegative and match the currency's precision.")
        return int(amount)
    except InvalidOperation as exc:
        raise ValueError("Invalid monetary amount.") from exc


def major(value, currency):
    digits = exponent(currency)
    return f"{Decimal(value) / (10 ** digits):.{digits}f}"


def offer_minor(offer, currency):
    if not offer or offer.get("currency") != currency:
        return None
    value = offer.get("price_amount", offer.get("total_price", offer.get("estimated_total")))
    try:
        return minor(value, currency)
    except ValueError:
        return None
