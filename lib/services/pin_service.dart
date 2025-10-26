
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
class PinService {
  static const _pinKey='admin_pin';
  static const _default='Medi@1234';
  static final _s = FlutterSecureStorage();
  static Future<void> ensureDefaultPin() async { if((await _s.read(key:_pinKey))==null) await _s.write(key:_pinKey, value:_default); }
  static Future<bool> verifyPin(String p) async { return (await _s.read(key:_pinKey))==p; }
  static Future<bool> changePin({required String oldPin, required String newPin}) async { if(!await verifyPin(oldPin)) return false; await _s.write(key:_pinKey, value:newPin); return true; }
}
