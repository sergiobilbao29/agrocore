# -*- coding: utf-8 -*-
"""Instructivo: Novedades y como usarlas (grupo economico, carga multi-lote,
cheques por PDF, sueldos por transferencia). Estilo AgroCore."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Novedades.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=21, textColor=G900, spaceAfter=2, leading=25)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_h3    = S("h3", fontName="Helvetica-Bold", fontSize=11.5, textColor=G900, spaceBefore=8, spaceAfter=3, leading=15)
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
    E.append(Paragraph("Novedades y como usarlas", st_title))
    E.append(Paragraph("Grupo economico, carga en varios lotes, cheques por PDF y sueldos por transferencia", st_sub))
    E.append(Paragraph(
        "Esta guia resume las <b>funciones nuevas</b> y como aprovecharlas en el dia a dia. Cada seccion es independiente: "
        "usa la que necesites.", st_intro))

    # 1 - Grupo economico: campos compartidos
    E.append(Paragraph("1 &nbsp;&mdash;&nbsp; Grupo economico: empleados y campos COMPARTIDOS", st_h2))
    E.append(Paragraph("Si trabajas con varias empresas del mismo grupo, ahora podes cargar un <b>empleado</b> o un <b>campo</b> "
                       "<b>una sola vez</b> y usarlo en todas, sin recargarlo en cada empresa.", st_intro))
    E.append(Paragraph("Empleado compartido", st_h3))
    E.append(steps([
        "Entra a la <b>ficha del empleado</b> (Administracion &rarr; Empleados).",
        "Tilda <b>“Compartir con el grupo”</b> y guarda.",
        "A partir de ahi vas a ver y usar ese empleado en <b>todas tus empresas</b> (labores, planillas, etc.). Se da de alta en una sola.",
    ]))
    E.append(Paragraph("Campo compartido", st_h3))
    E.append(steps([
        "Entra a la <b>ficha del campo</b> (Produccion &rarr; Campos) o crea uno nuevo.",
        "En la seccion <b>\U0001F310 Grupo economico</b>, tilda <b>“Compartir con el grupo”</b> y guarda.",
        "Ese campo y <b>todos sus lotes</b> quedan visibles en todas tus empresas. Cargas <b>Montenegro una sola vez</b>.",
        "Despues, en cada campania elegis el <b>lote</b> y las <b>hectareas</b> con la empresa que corresponda esa temporada.",
    ]))
    E.append(callout("<b>Clave:</b> el campo/lote es solo el <b>lugar fisico</b>. Cada <b>campania</b> sigue siendo de la empresa que "
                     "la siembra esa temporada (no cambia la titularidad fiscal de nada). Asi un ano usa el lote una empresa y otro "
                     "ano otra, y se mantiene la <b>comparacion ano a ano</b> del campo.", G100, G600, G900))
    E.append(callout("Los campos de <b>otra empresa</b> del grupo aparecen con el cartel <b>\U0001F310 Compartido</b> y solo los puede "
                     "<b>editar su dueno</b>. Vos los usas (cargas campanias, labores, insumos) pero no los editas ni borras.", BLUE_BG, BLUE_BD, BLUE_TX))

    # 2 - Carga en varios lotes
    E.append(Paragraph("2 &nbsp;&mdash;&nbsp; Cargar insumos o labores en VARIOS lotes de una vez", st_h2))
    E.append(Paragraph("Cuando varios lotes (del mismo campo o de campos pegados) se hacen <b>exactamente igual</b>, ya no hace falta "
                       "cargarlos uno por uno. Lo cargas una vez y lo replicas.", st_intro))
    E.append(Paragraph("Insumos", st_h3))
    E.append(steps([
        "En <b>Insumos y labores</b>, toca <b>+ Insumo</b> y elegi la <b>campania/lote</b> principal, la fecha y la moneda.",
        "Carga los insumos (tipo, producto, dosis/ha, costo).",
        "Abri el desplegable <b>“➕ Aplicar tambien a otras campanias / lotes”</b> y <b>tilda</b> las campanias donde se hizo lo mismo.",
        "Guarda: los <b>mismos insumos</b> se cargan en cada campania, usando las <b>hectareas del lote de cada una</b>. Cada una descuenta su propio stock.",
    ]))
    E.append(Paragraph("Labores", st_h3))
    E.append(steps([
        "Toca <b>+ Labor</b> y carga la labor (tipo, fecha, precio/ha, moneda, empleados e insumos si corresponde).",
        "Abri <b>“➕ Cargar esta misma labor en otras campanias / lotes”</b> y <b>tilda</b> las campanias.",
        "Guarda: la <b>misma labor</b> (con sus insumos y empleados) se carga en cada una, con las hectareas del lote de cada campania. Los insumos escalan solos a esas hectareas.",
    ]))
    E.append(callout("Es <b>opcional</b>: si no abris el desplegable, la carga funciona igual que siempre (una sola campania). "
                     "La opcion de labor <b>no aplica</b> a servicios a terceros ni cuando estas <b>editando</b> una labor existente.",
                     AMBER_BG, AMBER_BD, AMBER_TX))
    E.append(Paragraph("<b>Tip:</b> si un lote se hizo otro dia, podes cargar todos juntos igual y despues ajustar la fecha del "
                       "que difiera desde su propio renglon de insumos/labores.", st_intro))

    # 3 - Importar cheques por PDF
    E.append(Paragraph("3 &nbsp;&mdash;&nbsp; Importar e-cheques desde el PDF del homebanking", st_h2))
    E.append(Paragraph("Para no cargar los e-cheques a mano, podes subir el <b>PDF</b> que te da el banco (Galicia y similares) y el "
                       "sistema lee los datos solo.", st_intro))
    E.append(steps([
        "En <b>Tesoreria &rarr; Cheques</b>, toca <b>\U0001F4C4 Importar PDF</b>.",
        "Elegi uno o <b>varios</b> PDF de e-cheque (el “Detalle de cheque electronico” que baja del homebanking).",
        "El sistema lee N°, importe, banco, fechas, beneficiario/librador, CUIT y motivo, y detecta si es <b>propio o de terceros</b>.",
        "Si es <b>uno</b>, te abre el cheque <b>prellenado</b> para revisar y guardar. Si son <b>varios</b>, te muestra la lista para confirmar y <b>Guardar seleccionados</b>.",
    ]))
    E.append(callout("Avisa si un cheque <b>ya esta cargado</b> (por su N°) para no duplicar: esos vienen destildados. "
                     "El PDF tiene que ser el <b>original del homebanking</b> (no una foto/escaneo).", BLUE_BG, BLUE_BD, BLUE_TX))
    E.append(callout("<b>Recorda:</b> la pantalla de Cheques arranca mostrando solo los <b>“En cartera”</b>. Para ver los emitidos, "
                     "depositados o transferidos, pone el filtro <b>Estado &rarr; Todos</b>. Nunca se pierden: estan en otro estado.", AMBER_BG, AMBER_BD, AMBER_TX))

    # 4 - Sueldos por transferencia + recibo
    E.append(Paragraph("4 &nbsp;&mdash;&nbsp; Sueldos: pago por transferencia, detalle y recibo", st_h2))
    E.append(Paragraph("Al liquidar un sueldo por <b>transferencia</b>, ahora se refleja en el banco; y cada liquidacion tiene su "
                       "<b>detalle</b> y su <b>recibo imprimible</b>.", st_intro))
    E.append(steps([
        "En la ficha del empleado, al <b>liquidar</b>, elegi medio de pago <b>Transferencia</b> y la <b>cuenta bancaria</b> real de la que sale la plata.",
        "Al guardar, se genera el <b>egreso en Bancos</b> de esa cuenta (antes quedaba solo registrado). Tambien vale para el pago <b>combinado</b>.",
        "En el <b>Historial de liquidaciones</b>, cada mes tiene <b>\U0001F441 Detalle</b> (como se compone: ganancias, gastos/adelantos, neto, saldo del mes anterior y total a pagar) y <b>\U0001F9FE Recibo</b> (imprimible / PDF, con firmas).",
    ]))
    E.append(callout("<b>Cuidado con los adelantos:</b> la plata que ya le diste antes va como <b>adelanto</b> (gasto); lo que pagas al "
                     "liquidar es el <b>pago</b>. La misma plata se carga <b>una sola vez</b> (o como adelanto, o como pago), nunca las dos. "
                     "El saldo pasa solo de un mes al siguiente (cuenta corriente con arrastre).", AMBER_BG, AMBER_BD, AMBER_TX))

    # 5 - Recuperar articulos desde backup (admin)
    E.append(Paragraph("5 &nbsp;&mdash;&nbsp; (Administrador) Recuperar articulos desde un respaldo", st_h2))
    E.append(Paragraph("Si por error se borraron articulos de Stock, un administrador puede recuperarlos del ultimo respaldo del "
                       "servidor, sin tocar nada de lo que ya existe.", st_intro))
    E.append(steps([
        "En <b>Stock</b>, toca <b>\U0001F5C4 Recuperar desde backup</b> (solo administrador).",
        "Elegi el <b>respaldo</b> (por defecto el mas reciente; conviene uno anterior al borrado) y confirma.",
        "Vuelven solo los articulos que faltan, con su clasificacion. No se tocan los que ya existen ni ningun otro dato.",
    ]))

    # FAQ
    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("Comparti un campo pero no lo veo en la otra empresa.",
         "Entra a la otra empresa (selector de arriba a la izquierda) y fijate en Produccion -> Campos: aparece con el cartel Compartido. En el selector de campania/lote tambien sale."),
        ("Cargue una labor en varios lotes y las hectareas quedaron distintas.",
         "Es correcto: cada campania usa las hectareas de SU lote. Los insumos escalan solos a esas hectareas."),
        ("El importador de cheques no reconoce el PDF.",
         "Tiene que ser el PDF original del homebanking (Detalle de cheque electronico). Si es una foto o escaneo, cargalo a mano con + Nuevo."),
        ("Pague un sueldo por transferencia y no lo veo en el banco.",
         "Elegi la cuenta bancaria al liquidar. Si una liquidacion vieja no lo reflejo, anulala y volvela a hacer eligiendo la cuenta."),
    ]
    for q, a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
