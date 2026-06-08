namespace AgroCore.Domain.Enums;

public enum CondicionIva { RI, MONO, EX, CF, NR }

public enum EstadoOrden { Planificada = 0, EnEjecucion = 1, Finalizada = 2, Cancelada = 3 }

public enum TipoLabor { Siembra, Pulverizacion, Fertilizacion, Cosecha, Laboreo, Riego, Traslado, Otro }

public enum TipoMovimientoStock { Ingreso = 1, Egreso = -1, Ajuste = 0 }

public enum TipoInsumo { Semilla, Fertilizante, Herbicida, Fungicida, Insecticida, Combustible, Repuesto, Otro }

public enum TipoHacienda { Vaca, Toro, Vaquillona, Ternero, Novillo, Otro }

public enum EstadoHacienda { Activo, Vendido, Muerto, Traslado }

public enum TipoCheque { Propio, Tercero }

public enum EstadoCheque { EnCartera, Depositado, Acreditado, Rechazado, Endosado, Anulado }

public enum TipoCuentaCorriente { Cliente, Proveedor }

public enum TipoComprobante { FacturaA, FacturaB, FacturaC, NotaCreditoA, NotaCreditoB, NotaCreditoC, NotaDebitoA, NotaDebitoB, NotaDebitoC, Recibo, Remito, Presupuesto }

public enum EstadoComprobante { Pendiente, Autorizado, Rechazado, Anulado }

public enum TipoMovimientoCaja { Ingreso, Egreso, Transferencia }

public enum MedioPago { Efectivo, Transferencia, ChequePropio, ChequeTercero, Deposito, Compensacion, Tarjeta, Otro }

public enum TipoArrendamiento { Fijo, PorQuintales, Porcentaje, Mixto }

public enum EstadoCampana { Planificada, EnCurso, Cosechada, Cerrada }

public enum AccionAuditoria { Insert, Update, Delete, Login, Logout, LoginFail, Sync, Export }

public enum ConflictResolution { ServerWins, ClientWins, Manual }
