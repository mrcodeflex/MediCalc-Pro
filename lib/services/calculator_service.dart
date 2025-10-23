
import 'dart:convert'; import 'package:flutter/services.dart' show rootBundle;
class CalculatorService { static Future<List<Map<String,dynamic>>> loadCalculators() async {
  final raw = await rootBundle.loadString('assets/data/calculators.json');
  return List<Map<String,dynamic>>.from(json.decode(raw) as List);
} }
