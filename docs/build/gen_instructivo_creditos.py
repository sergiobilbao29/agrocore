# -*- coding: utf-8 -*-
"""Instructivo: Creditos bancarios — carga, pago y alertas en el calendario (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Creditos-Bancarios.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
RED_BG = colors.HexColor("#fee2e2"); RED_BD = colors.HexColor("#ef4444"); RED_TX = colors.HexColor("#991b1b")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=20, textColor=G900, spaceAfter=2, leading=24)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)

def callout(text, bg, bd, tx):
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return t

def steps(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)

def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletChar="•", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=1, spaceAfter=1)

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13); canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, "Instructivo")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazon del negocio agricola")
    canvas.drawRightString(w-15*mm, 10*mm, "Pagina %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Creditos bancarios", st_title))
    E.append(Paragraph("Cargar un credito (nuevo o ya empezado), pagar las cuotas y ver sus vencimientos en el calendario", st_sub))
    E.append(Paragraph(
        "Un <b>credito bancario</b> en AgroCore es un prestamo del banco con un <b>plan de cuotas</b>. Cuando lo cargas, el "
        "sistema <b>arma solo todas las cuotas</b> con su vencimiento e importe. Despues vas <b>pagando cada cuota</b> con el "
        "medio que uses (transferencia, debito, efectivo, cheque o tarjeta) y el sistema lleva la cuenta de lo pagado y lo "
        "pendiente. Ademas, <b>cada cuota que vence aparece sola en la Agenda / Calendario</b> como recordatorio y en el "
        "<b>Flujo de fondos</b> como egreso proyectado, para que nunca se te pase un pago.", st_intro))
    E.append(callout("<b>La idea en una linea:</b> &nbsp; cargas el credito con su plan de cuotas &rarr; el sistema arma todas las "
                     "cuotas &rarr; las pagas una por una &rarr; cada vencimiento te aparece en la Agenda y el Flujo de fondos.",
                     G100, G600, G900))
    E.append(callout("<b>Donde esta:</b> menu <b>Tesoreria &rarr; \U0001F3E6 Creditos bancarios</b>. Para cargar hace falta el "
                     "permiso de Finanzas; para pagar cuotas, el permiso de <b>Marcar cuotas de credito como pagadas</b> (se "
                     "asignan por rol en Administracion &rarr; Roles).", BLUE_BG, BLUE_BD, BLUE_TX))

    # ----- Antes de empezar
    E.append(Paragraph("Antes de empezar: cargar el banco en el catalogo", st_h2))
    E.append(steps([
        "El <b>Banco</b> del credito se elige de una lista. Si todavia no esta, cargalo en "
        "<b>Configuracion &rarr; Catalogos &rarr; Bancos</b> (ej. Nacion, Galicia, BBVA...).",
        "Opcional pero recomendado: tene cargada la <b>cuenta bancaria</b> (Tesoreria &rarr; Bancos) de donde vas a pagar "
        "las cuotas, asi el pago queda registrado en el extracto.",
    ]))

    # ----- PASO 1 credito nuevo
    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Cargar un credito NUEVO", st_h2))
    E.append(steps([
        "Anda a <b>Tesoreria &rarr; Creditos bancarios</b> y toca <b>+ Nuevo credito</b>.",
        "Completa los datos: <b>Banco</b> (*), <b>Nro de operacion</b> (opcional), <b>Monto del credito</b> (*), "
        "<b>Moneda</b> (*), <b>Tasa anual % (TNA)</b> y, si corresponde, <b>IVA sobre intereses (%)</b>.",
        "Define el plan: <b>Cantidad de cuotas</b> (*), <b>Periodicidad</b> (mensual, bimestral, trimestral, semestral o "
        "anual) y <b>Fecha de la primera cuota</b> (*).",
        "Opcional: <b>Destino</b> (ej. capital de trabajo, cosechadora) y <b>Observaciones</b>.",
        "Elegi el <b>Plan de cuotas</b> (ver PASO 2) y toca <b>\U0001F4BE Crear credito</b>. El sistema <b>genera todas las "
        "cuotas</b> con su vencimiento e importe.",
    ]))
    E.append(callout("<b>Tasa e IVA de intereses:</b> en el plan <b>automatico</b> el sistema calcula el interes de cada cuota "
                     "con la TNA (sistema frances, cuota constante) y, si cargas el <b>IVA sobre intereses</b>, lo suma a cada "
                     "cuota. Si no sabes la tasa, dejala vacia y usa el <b>plan manual</b> poniendo los importes que te paso el "
                     "banco.", AMBER_BG, AMBER_BD, AMBER_TX))

    # ----- PASO 2 plan auto vs manual
    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Plan de cuotas: Automatico o Manual", st_h2))
    E.append(Paragraph("En el formulario elegis como se arman las cuotas:", st_intro))
    E.append(bullets([
        "<b>Automatico (sistema frances):</b> <b>cuota constante</b>. Solo cargas monto, tasa, cantidad de cuotas, "
        "periodicidad y fecha de la primera; el sistema reparte capital e interes en cada cuota. Ideal para creditos "
        "comunes con cuota fija.",
        "<b>Manual (cargo cada cuota):</b> <b>vos pones el importe de cada cuota</b>. Toca <b>↻ Generar fechas</b> para "
        "que arme las filas segun la periodicidad (y reparta el monto en partes iguales) y despues <b>editas cada importe</b>. "
        "Con <b>+ Cuota</b> agregas filas. Ideal cuando las cuotas son <b>distintas</b> (ej. dan U$S 70.000 y las cuotas van "
        "10, 12, 15... mil hasta completar).",
    ]))
    E.append(callout("Abajo de la tabla manual el sistema muestra la <b>suma de las cuotas vs el monto del credito</b> y te "
                     "avisa si hay <b>diferencia</b> o si <b>✓ coincide</b>. No es obligatorio que cierre exacto, pero sirve "
                     "de control.", BLUE_BG, BLUE_BD, BLUE_TX))

    # ----- PASO 3 credito ya empezado
    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; Cargar un credito YA EMPEZADO (con cuotas ya pagas)", st_h2))
    E.append(Paragraph("Si el credito ya venia de antes y tiene cuotas pagadas, cargalo igual que uno nuevo y despues marca lo "
                       "que ya pagaste. Dos formas:", st_intro))
    E.append(bullets([
        "<b>Opcion A &mdash; Marcar pagadas hasta (lo mas rapido):</b> cargá el credito completo (todas las cuotas, desde la "
        "primera original). Despues abrilo con <b>\U0001F441 Ver</b> y toca <b>✅ Marcar pagadas hasta...</b>: escribis el "
        "numero de la ultima cuota que ya pagaste (ej. 6) y el sistema marca <b>de la 1 a la 6 como pagadas</b> de una. Quedan "
        "pendientes solo las que faltan.",
        "<b>Opcion B &mdash; Plan manual con fechas reales:</b> usa el plan <b>manual</b> y carga cada cuota con su "
        "<b>vencimiento real</b> (incluidas las que ya vencieron). Despues marcas las pagadas con la Opcion A o pagandolas una "
        "por una.",
    ]))
    E.append(callout("<b>Importante:</b> cuando <b>editas</b> un credito en plan automatico y cambias monto, tasa, cantidad de "
                     "cuotas, periodicidad o la fecha de la primera, el plan <b>se regenera</b> y se <b>pierden las marcas de "
                     "pago</b>. Por eso, para creditos ya empezados conviene <b>primero cargarlo bien</b> y recien despues marcar "
                     "las cuotas pagas.", RED_BG, RED_BD, RED_TX))

    # ----- PASO 4 pagar cuotas
    E.append(Paragraph("PASO 4 &nbsp;&mdash;&nbsp; Pagar una cuota", st_h2))
    E.append(steps([
        "En la lista de Creditos (o en <b>\U0001F441 Ver</b> el credito) busca la cuota pendiente y toca <b>\U0001F4B8 Pagar</b> "
        "(o <b>Marcar pagada</b>).",
        "Elegi el <b>Medio de pago</b>: <b>Transferencia</b> o <b>Debito automatico</b> (elegis la <b>cuenta bancaria</b> de "
        "donde sale), <b>Efectivo</b> (elegis la <b>caja</b>), <b>Cheque</b> (elegis un <b>cheque en cartera</b>) o "
        "<b>\U0001F4B3 Tarjeta de credito</b>.",
        "Opcional: <b>Gastos / IVA adicional</b> (sellos, gastos del credito, IVA de intereses que cargas a mano), "
        "<b>Referencia</b> (nro de operacion o cheque) y <b>Fecha de pago</b>.",
        "Toca <b>\U0001F4B8 Confirmar pago</b>. La cuota queda <b>Pagada</b> con su fecha, y si elegiste una cuenta/caja/cheque "
        "se registra el <b>egreso</b> correspondiente (en el extracto del banco, la caja o el cheque entregado).",
    ]))
    E.append(callout("<b>Credito en dolares u otra moneda:</b> al pagar una cuota en moneda extranjera, pone el <b>tipo de "
                     "cambio del dia del pago</b> y el sistema calcula <b>cuanto es en pesos</b> (el dolar varia hasta el dia que "
                     "pagas). El egreso en la cuenta bancaria queda en pesos a ese TC.", AMBER_BG, AMBER_BD, AMBER_TX))

    # ----- PASO 5 seguimiento
    E.append(Paragraph("PASO 5 &nbsp;&mdash;&nbsp; Ver el estado del credito", st_h2))
    E.append(bullets([
        "Toca <b>\U0001F441 Ver</b> en el credito para abrir su <b>detalle</b>: datos del prestamo, KPIs de <b>cuotas pagadas / "
        "pendientes / % completado</b> y la <b>tabla de cuotas</b> con capital, interes, total, estado (Pagada / Pendiente) y "
        "la fecha de pago.",
        "Desde ahi tambien podes <b>✏️ Editar</b> el credito, <b>✅ Marcar pagadas hasta...</b> o "
        "<b>\U0001F5D1️ Eliminar</b> (si no tiene cuotas pagadas).",
        "Un credito con <b>cuotas ya pagadas no se puede eliminar</b>: primero hay que deshacer esos pagos. Asi no se pierden "
        "datos por accidente.",
    ]))

    # ----- PASO 6 calendario
    E.append(Paragraph("PASO 6 &nbsp;&mdash;&nbsp; Como se ven y alertan en el Calendario / Agenda", st_h2))
    E.append(Paragraph("No hace falta cargar nada a mano: las cuotas de credito <b>aparecen solas</b> en varios lugares.", st_intro))
    E.append(bullets([
        "<b>Agenda / Calendario:</b> cada <b>cuota pendiente</b> aparece como recordatorio en su <b>fecha de vencimiento</b>, "
        "con un badge azul <b>\U0001F517 Auto</b> que la distingue de las que cargas a mano. Al tocarla, podes "
        "<b>“Abrir credito”</b> para ir directo a pagarla.",
        "<b>Inicio (alertas):</b> las cuotas proximas a vencer se muestran entre los avisos del tablero de inicio.",
        "<b>Flujo de fondos:</b> cada cuota futura se proyecta como <b>egreso</b> en el mes de su vencimiento (en pesos, o "
        "valorizada al TC de proyeccion si el credito es en dolares), para ver cuando cae la plata.",
        "<b>Estado de situacion / urgencia:</b> los vencimientos se pintan por urgencia (<b>rojo</b> si vence en menos de 7 "
        "dias, <b>ambar</b> dentro de 30, gris el resto).",
    ]))
    E.append(callout("<b>Se actualiza solo:</b> cuando <b>pagas</b> la cuota desde el credito, <b>desaparece sola</b> de la "
                     "Agenda y deja de proyectarse en el Flujo. Si una cuota la arreglaste por fuera y no queres verla, podes "
                     "<b>ocultarla</b> con \U0001F5D1️ en la Agenda: eso NO borra la cuota, solo la saca del recordatorio.",
                     G100, G600, G900))
    E.append(callout("<b>Alarmas editables:</b> las alertas automaticas (creditos, cheques, cuentas corrientes) se pueden "
                     "<b>editar/personalizar</b> desde la Agenda: al editar una automatica se crea una alarma propia que "
                     "reemplaza a la original (ej. para avisarte unos dias antes).", BLUE_BG, BLUE_BD, BLUE_TX))

    # ----- FAQ
    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("Cargue mal un credito nuevo y quiero rehacerlo. Puedo?",
         "Si no tiene cuotas pagadas, abrilo con Ver y Eliminar, o editalo (al cambiar monto/tasa/cuotas/periodicidad/fecha se regenera el plan). Si ya tiene cuotas pagas, primero hay que deshacer esos pagos."),
        ("El banco me dio cuotas distintas (no son todas iguales). Como lo cargo?",
         "Usa el plan MANUAL: toca Generar fechas y despues edita el importe de cada cuota con el valor real que te paso el banco. La suma vs el monto del credito te sirve de control."),
        ("Es un credito viejo que ya tiene 8 cuotas pagas. Que hago?",
         "Cargalo completo (todas las cuotas desde la primera) y despues, en Ver, usa 'Marcar pagadas hasta... 8'. Quedan pendientes solo las que faltan y la Agenda solo te muestra esas."),
        ("Al pagar una cuota, me descuenta del banco?",
         "Solo si elegis la cuenta bancaria (transferencia o debito), la caja (efectivo), un cheque en cartera o una tarjeta. Si dejas 'Sin registrar en banco', la cuota queda marcada pagada pero no mueve ninguna cuenta (util para cargar historia vieja)."),
        ("Por que una cuota no me aparece en la Agenda?",
         "Aparecen solo las cuotas PENDIENTES (no pagadas) con su fecha de vencimiento. Si ya la pagaste, desaparece. Si la ocultaste a mano en la Agenda, se puede restaurar."),
        ("El credito es en dolares. Como se maneja?",
         "Al cargarlo pones el TC del dia que te lo habilitaron (para ver el total en pesos ingresado). Al pagar cada cuota pones el TC del dia del pago y el sistema calcula el equivalente en pesos del egreso."),
        ("Quien puede cargar y quien puede pagar cuotas?",
         "Depende de los permisos del rol: 'Finanzas' para cargar/editar el credito y 'Marcar cuotas de credito como pagadas' para registrar los pagos. Se configuran en Administracion -> Roles."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
