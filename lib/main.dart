
import 'package:flutter/material.dart';
import 'app.dart';
import 'services/pin_service.dart';
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await PinService.ensureDefaultPin();
  runApp(MyApp());
}
