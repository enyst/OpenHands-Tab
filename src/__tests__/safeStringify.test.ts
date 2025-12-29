import { describe, it, expect } from 'vitest';
import { safeStringify } from '../shared/safeStringify';

describe('safeStringify', () => {
  it('redacts hyphenated api key headers', () => {
    expect(safeStringify({ 'x-goog-api-key': 'abc123' })).toBe('{"x-goog-api-key":"[REDACTED]"}');
    expect(safeStringify({ 'xi-api-key': 'def456' })).toBe('{"xi-api-key":"[REDACTED]"}');
  });

  describe('LLM API encrypted/signature field truncation', () => {
    it('truncates encrypted_content from OpenAI Responses API', () => {
      const longEncryptedContent = 'gAAAAABpUroThZmuFVDx9jCG_CfsHbzZ3NNNWgUw3rTfZqZfy-e67LNymJDgbJRzXt9CQJyUb_bM-EFopvT0xMH3Cvh4HrNAI-I92zBfp53G32xsAiigUbm1kXzgrfebpgKduvBC_3nmq9uNh4uihuzXEyXhF-N8lm-mNaV1aI2SSwomgPRYqjB86HoffwBLgDNNhcCdabbosIu-i0J85ghQH94uHjGLRBjreu5LTTzqQcqtzXCzcb8wJp1TZpDBm2PusbdsdaygAiuqu1uWZOuu6lEADGGMTntRyH8uDL9FhP8eRy4nLnq9Kh72ZITQbTTgl_sAZWV8YUQhsCIILd0GI62P9OfaIoMfe4-8DvCE2DQq7UGFHgLSIqGDEARbX_22pgWLFD0M1tN6DETqLmPNdi7354yFUEnsgPZBQnUKPQkw0WQL5OE501KJ9NZJ2kWiFS8XTi9BshRakJTyi5NNYC34oMhgiSp6qTIycvWdMGLqZ7EvFRz2h74uGvVHLqbahwLO0L5jtz4rFlwWwv8PhqJTGOT_nk-oCPNm5P9MTW9Q5xfqMaM7aUDfgzPlh4P9xdEk-_DJC_iM-OJOYs2jRvIWSHEP7_qAwOKd14eyWxdx72I42adI_nb5CIxGvwcNVClXflPtA1ZXZmVruWtWl17bpIF21GTY-jyRjONEMiEf30beQJw2LVok_qCB4hxrJMayZY1cgBWlxUp1BgS_ds16durKGOsVdev9kRLvdmCVUCswmD7qyLCoorM2yGuYCMSIfn5sU2Vzyz_vc9odNyPnEoa8Gk-CHI-3ZeErXj2t_jtRHQBz2fv5qY2Debpd4xDZsecwOdXnCrYIeYDsQ0PAHH41fA2qDCHe6qb5dtAt3rf1Jl5xHwBaWL3SrgS1IaO76C4BD_Ed17XTjPjmOVubBrwmwaEs2NhwesElM7MUy1mBZrui_OxwhOtt_Ic4y61k-H2KoceXRZZoIqMcvooXMWoyp_WgnNJTv2hj5UYTPN9hVkJDpnSpmf2jAFg1Zzup8oMRgVVMlIRrnMYbC6_pOA24QfY8KGUyonrb6JUp9RtUms40ww3iFdrvWbvYIMTHNCvqNThDGpLLsUVr-IUnYeigxoGZc_9GUk-Ii9uH5J3IdsjRaUNg05-Xkfzq5Xzy44b86q9gVrjMsCrOCf1cPg0ZklRHwGUVUPxCTJzWPEVhfmMTIO-7os5uPS-ZsTQah-ZUFbmBo2n9qaMgG7fAyEwYIaD_b7NhK6ygQtG8cnkJgy6HdXKWZgYWkizM-JWJYvGCni-FE-E74wuB9yptizi208ypJZYRZapu1wvGYONUpvzdEhBg5S2i5bl6VAjnx3upZU7u4WldaGOl7ujJv21VrCbLMG5WhDCeph1fxVQAUtHM18Faa4rHPRgyWULZ_eek_Wks0iUb9remTOvdX9ag9MZchgip2GDxByuXWS6gfXZcoM_kX24xCtATC3mRm7k_5KbCcE_PARcr5yECMFSr2IHd0DkOZyhlJIIAnUlwq4o9N8-fdWEtIRqGEGZFTBfJfSj5tm91ygNcOM-T7008Sh4RSZUR61B92S_p7hxsILPhjVK7P3Z-MZLjcwqxYZ96WYjcOjbLEEar6pIOfb4O5gxEQANo_1MRklrmV25HSSkTt2yIwtWG8rkMaxtiAZDGXJMUTS2Zq_hjYYhTOMTUhzBcP24bYjPYTvM8RW_ML2JzACWzZXt02Ymo2PGzWl0kDKrep5-SlQjmysMYI943lO1XnixxO9szpZt6aCeYGtAqhUqZvgK8hPdyOAUYV4KC_bn0CQC909J4wtsSKK3XOFkbnd2WcLrUJg9byxD5JPP4SORs7FlTByKfXgOp_E_kxe2WYIwuE-vWE2RdFcPZG-87SYsdCQajRkhDcP6Eo0v_TdJeffVq7_lTKNIMVhkSS1VIUPAWQp-UHB751KFmZ8arTwBQweHRluIegWJin5Dw_METliGZImm1E58ejO4bD4r3clCNbIIu9XW5kdyk9Hq9qd_5QQMfRU_hwwHuD1iPNZheUjZzyWcu3XLOj6JAUoHP_QayMCNXgjFR3Sdvwm13arwyed1LjfK7rZAKxQ4=';
      const event = {
        kind: 'MessageEvent',
        llm_message: {
          responses_reasoning_item: {
            id: 'rs_0ef1339168cb2c8a016952ba0d6580819db96b1a735d062c97',
            encrypted_content: longEncryptedContent,
          },
        },
      };
      const result = safeStringify(event);
      expect(result).toContain('"encrypted_content":"gAAA...xQ4="');
      expect(result).not.toContain(longEncryptedContent);
    });

    it('truncates thinking_signature from Anthropic extended thinking', () => {
      const longSignature = 'ErUBCkYIARgCIkCPmFLBW8L3T5X9vK2mN7qR4sD6wY1hJ0uZ3xA8bC5fG2iE9jK4lM7nO0pQ3rS6tU9vW2xY5zA8bC1dE4fG';
      const message = {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        thinking_signature: longSignature,
      };
      const result = safeStringify(message);
      expect(result).toContain('"thinking_signature":"ErUB...E4fG"');
      expect(result).not.toContain(longSignature);
    });

    it('truncates signature from Anthropic thinking blocks', () => {
      const longSignature = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
      const thinkingBlock = {
        type: 'thinking',
        thinking: 'Let me think about this...',
        signature: longSignature,
      };
      const result = safeStringify(thinkingBlock);
      expect(result).toContain('"signature":"AbCd...6789"');
      expect(result).not.toContain(longSignature);
    });

    it('does not truncate short encrypted_content values', () => {
      const shortValue = 'short';
      const event = { encrypted_content: shortValue };
      const result = safeStringify(event);
      expect(result).toBe('{"encrypted_content":"short"}');
    });

    it('does not truncate values at the minimum length boundary', () => {
      // Minimum length is 11 (4 + 3 + 4), so 10 chars should not be truncated
      const tenChars = '0123456789';
      const event = { encrypted_content: tenChars };
      const result = safeStringify(event);
      expect(result).toBe('{"encrypted_content":"0123456789"}');
    });

    it('truncates values just above the minimum length', () => {
      // 11 chars should be truncated
      const elevenChars = '01234567890';
      const event = { encrypted_content: elevenChars };
      const result = safeStringify(event);
      expect(result).toBe('{"encrypted_content":"0123...7890"}');
    });
  });
});
